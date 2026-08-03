import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { StreamVariant } from "@/models/StreamVariant";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { firstValueFrom } from "rxjs";
import { ContainerEventRepository } from "./ContainerEventRepository";

describe(ContainerEventRepository.name, () => {
  let context: TestEnvironment.Context;
  let repository: ContainerEventRepository;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    repository = context.containerEventRepository;
  });

  it("should round-trip every kind of event", async () => {
    // given
    const container = TestFixture.container({ name: "web", group: "shop" });
    const events: ContainerEvent[] = [
      TestFixture.startEvent({ container }),
      TestFixture.logEvent({ container, line: "GET / 200", streamVariant: StreamVariant.stdout }),
      TestFixture.logEvent({ container, line: "boom", streamVariant: StreamVariant.stderr }),
      TestFixture.logThrottleEvent({ container, foldCount: 12 }),
      TestFixture.stopEvent({ container }),
    ];

    // when
    await repository.append(events);
    // then
    const { events: stored } = await repository.listEvents(container.id, 100);
    expect(stored.map(({ type }) => type)).toEqual([
      ContainerEvent.Type.start,
      ContainerEvent.Type.log,
      ContainerEvent.Type.log,
      ContainerEvent.Type.log_throttle,
      ContainerEvent.Type.stop,
    ]);
    expect(stored.at(1)).toEqual(
      expect.objectContaining({ line: "GET / 200", streamVariant: StreamVariant.stdout } satisfies Partial<ContainerEvent>),
    );
    expect(stored.at(2)).toEqual(expect.objectContaining({ streamVariant: StreamVariant.stderr } satisfies Partial<ContainerEvent>));
    expect(stored.at(3)).toEqual(expect.objectContaining({ foldCount: 12 } satisfies Partial<ContainerEvent>));
    expect(stored.at(1)?.container).toEqual(container);
  });

  it("should answer with events that have been recorded but not yet written", async () => {
    // given (nothing has been flushed, so the database is still empty)
    const container = TestFixture.container();
    repository.save(TestFixture.logEvent({ container, line: "not on disk yet" }));

    // when
    const { events } = await repository.listEvents(container.id, 100);
    // then
    expect(events.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["not on disk yet"]);

    // and the same events are not served twice once they do land
    await repository.flush();
    const { events: afterFlush } = await repository.listEvents(container.id, 100);
    expect(afterFlush).toHaveLength(1);
  });

  it("should join written and unwritten events into one uninterrupted page", async () => {
    // given (half written, half still buffered -- the seam the reader must not see)
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await repository.append(all.slice(0, 5));
    all.slice(5).forEach((event) => repository.save(event));

    // when
    const { events } = await repository.listEvents(container.id, 100);
    // then
    expect(events.map((event) => event.id)).toEqual(all.map((event) => event.id));
  });

  it("should honour the cursor across both halves", async () => {
    // given
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await repository.append(all.slice(0, 5));
    all.slice(5).forEach((event) => repository.save(event));

    // when (asking for what came before an event that is itself still buffered)
    const { events } = await repository.listEvents(container.id, 100, all[7]!.id);
    // then (everything older, from both halves, and nothing at or after the cursor)
    expect(events.map((event) => event.id)).toEqual(all.slice(0, 7).map((event) => event.id));
  });

  it("should keep unwritten events when the write fails, rather than losing them", async () => {
    // given
    const container = TestFixture.container();
    repository.save(TestFixture.logEvent({ container, line: "survives" }));
    const broken = new Error("database is locked");
    const append = spyOn(repository, "append").mockRejectedValueOnce(broken);

    // when
    await expect(repository.flush()).rejects.toThrow(broken);
    // then (still readable, and a later flush still writes them)
    append.mockRestore();
    expect((await repository.listEvents(container.id, 100)).events).toHaveLength(1);
    await repository.flush();
    expect((await repository.listEvents(container.id, 100)).events).toHaveLength(1);
  });

  it("should record one container row however many events it produces", async () => {
    // given
    const web = TestFixture.container({ name: "web" });
    const worker = TestFixture.container({ name: "worker" });

    // when
    await repository.append([
      ...Array.from({ length: 50 }, () => TestFixture.logEvent({ container: web })),
      ...Array.from({ length: 50 }, () => TestFixture.logEvent({ container: worker })),
    ]);
    // then
    expect(await containers()).toEqual([web, worker]);
    expect((await repository.listEvents(web.id, 1_000)).events).toHaveLength(50);
    expect((await repository.listEvents(worker.id, 1_000)).events).toHaveLength(50);
  });

  it("should keep a container's identity current across batches", async () => {
    // given (a container is renamed, or joins a compose project, between batches)
    const before = TestFixture.container({ name: "old-name" });
    const after = { ...before, name: "new-name", group: "shop" };

    // when
    await repository.append([TestFixture.logEvent({ container: before })]);
    await repository.append([TestFixture.logEvent({ container: after })]);
    // then (still one row, carrying the latest identity)
    expect(await containers()).toEqual([after]);
  });

  it("should keep only the newest events per container, independently of each other", async () => {
    // given (one chatty container and one quiet one)
    const chatty = TestFixture.container({ name: "chatty" });
    const quiet = TestFixture.container({ name: "quiet" });
    await repository.append([
      ...Array.from({ length: 100 }, (_, i) => TestFixture.logEvent({ container: chatty, line: `chatty ${i}` })),
      ...Array.from({ length: 3 }, (_, i) => TestFixture.logEvent({ container: quiet, line: `quiet ${i}` })),
    ]);

    // when
    const pruned = await repository.pruneToEventsPerContainer(10);
    // then (the quiet one is untouched -- its own history is not the chatty one's to spend)
    expect(pruned.events).toEqual(90);
    expect((await repository.listEvents(quiet.id, 1_000)).events).toHaveLength(3);
    const { events: remaining } = await repository.listEvents(chatty.id, 1_000);
    expect(remaining).toHaveLength(10);
    expect(remaining.at(0)).toEqual(expect.objectContaining({ line: "chatty 90" } satisfies Partial<ContainerEvent>));
    expect(remaining.at(-1)).toEqual(expect.objectContaining({ line: "chatty 99" } satisfies Partial<ContainerEvent>));
  });

  it("should leave a container alone while it is under its own cap", async () => {
    // given
    const container = TestFixture.container();
    await repository.append(Array.from({ length: 5 }, () => TestFixture.logEvent({ container })));

    // when
    const pruned = await repository.pruneToEventsPerContainer(10);
    // then
    expect(pruned.events).toEqual(0);
    expect((await repository.listEvents(container.id, 1_000)).events).toHaveLength(5);
  });

  it("should do nothing while the database fits the budget", async () => {
    // given
    const container = TestFixture.container();
    await repository.append(Array.from({ length: 10 }, () => TestFixture.logEvent({ container })));

    // when
    const pruned = await repository.pruneToSize(64 * 1024 * 1024);
    // then
    expect(pruned).toEqual({ events: 0, containers: 0 });
    expect((await repository.listEvents(container.id, 1_000)).events).toHaveLength(10);
  });

  it("should prune the oldest events first, and forget containers left with none", async () => {
    // given (the one event of `gone` is the oldest, so it is first out)
    const gone = TestFixture.container({ name: "gone" });
    const staying = TestFixture.container({ name: "staying" });
    await repository.append([TestFixture.logEvent({ container: gone, line: "goodbye" })]);
    // more than one prune chunk, so that some of them survive it
    await repository.append(
      Array.from({ length: 15_000 }, (_, i) => TestFixture.logEvent({ container: staying, line: `line ${i} `.repeat(30) })),
    );

    // when (a budget well under the ~7.5 MB those events occupy, but far enough above what one
    // chunk leaves behind that the loop is not deciding on a rounding difference)
    const pruned = await repository.pruneToSize(5 * 1024 * 1024);
    // then
    expect(pruned.events).toBeGreaterThan(0);
    expect(pruned.containers).toEqual(1);
    expect(await containers()).toEqual([staying]);
    // whatever survived is the newest, so the very first line is long gone
    const { events: remaining } = await repository.listEvents(staying.id, 100_000);
    expect(remaining.length).toBeGreaterThan(0);
    expect(remaining.length).toBeLessThan(15_000);
    expect(remaining.at(0)).not.toEqual(expect.objectContaining({ line: "line 0 ".repeat(30) } satisfies Partial<ContainerEvent>));
  });

  it("should republish the container overview only when the set actually changes", async () => {
    // given
    const container = TestFixture.container();
    const published: Container[][] = [];
    repository.streamContainers().subscribe((list) => published.push(list));

    // when (three batches, all from the same already-known container)
    await repository.append([TestFixture.logEvent({ container })]);
    await repository.append([TestFixture.logEvent({ container })]);
    await repository.append([TestFixture.logEvent({ container })]);
    // then (the seed, plus one emission for the container appearing -- not one per batch)
    expect(published).toEqual([[], [container]]);
  });

  /** The overview the repository publishes, which is always current after a mutation. */
  async function containers(): Promise<Container[]> {
    return await firstValueFrom(repository.streamContainers());
  }
});
