import { Container } from "@/models/Container";
import { Temporal } from "@js-temporal/polyfill";
import { ContainerEvent } from "@/models/ContainerEvent";
import { StreamVariant } from "@/models/StreamVariant";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { firstValueFrom } from "rxjs";
import { LogRepository } from "./LogRepository";

describe(LogRepository.name, () => {
  let context: TestEnvironment.Context;
  let repository: LogRepository;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    repository = context.logRepository;
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
    await write(events);
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
    repository.saveEvent(TestFixture.logEvent({ container, line: "not on disk yet" }));

    // when
    const { events } = await repository.listEvents(container.id, 100);
    // then
    expect(events.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["not on disk yet"]);

    // and the same events are not served twice once they do land
    await flush();
    const { events: afterFlush } = await repository.listEvents(container.id, 100);
    expect(afterFlush).toHaveLength(1);
  });

  it("should join written and unwritten events into one uninterrupted page", async () => {
    // given (half written, half still buffered -- the seam the reader must not see)
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await write(all.slice(0, 5));
    all.slice(5).forEach((event) => repository.saveEvent(event));

    // when
    const { events } = await repository.listEvents(container.id, 100);
    // then
    expect(events.map((event) => event.id)).toEqual(all.map((event) => event.id));
  });

  it("should honour the cursor across both halves", async () => {
    // given
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await write(all.slice(0, 5));
    all.slice(5).forEach((event) => repository.saveEvent(event));

    // when (asking for what came before an event that is itself still buffered)
    const { events } = await repository.listEvents(container.id, 100, all[7]!.id);
    // then (everything older, from both halves, and nothing at or after the cursor)
    expect(events.map((event) => event.id)).toEqual(all.slice(0, 7).map((event) => event.id));
  });

  it("should keep unwritten events when the write fails, rather than losing them", async () => {
    // given
    const container = TestFixture.container();
    repository.saveEvent(TestFixture.logEvent({ container, line: "survives" }));
    const transaction = spyOn(context.sqlite, "transaction").mockImplementationOnce(() => {
      throw new Error("database is locked");
    });

    // when (a flush that fails)
    await flush();
    // then (still readable, and the next flush still writes them)
    expect((await repository.listEvents(container.id, 100)).events).toHaveLength(1);
    transaction.mockRestore();
    await flush();
    expect((await repository.listEvents(container.id, 100)).events).toHaveLength(1);
  });

  it("should give up on a batch the database will never accept, rather than wedging every write behind it", async () => {
    // given (a write that fails every single time, not just once)
    const container = TestFixture.container();
    repository.saveEvent(TestFixture.logEvent({ container, line: "poison" }));
    const transaction = spyOn(context.sqlite, "transaction").mockImplementation(() => {
      throw new Error("constraint violated");
    });

    // when (flushed until it gives up)
    for (let attempt = 0; attempt < 5; attempt++) {
      await flush();
    }
    transaction.mockRestore();

    // then (the bad batch is gone, and events queued after it are written normally)
    repository.saveEvent(TestFixture.logEvent({ container, line: "written after the bad batch" }));
    await flush();
    const { events } = await repository.listEvents(container.id, 100);
    expect(events.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["written after the bad batch"]);
  });

  it("should record one container row however many events it produces", async () => {
    // given
    const web = TestFixture.container({ name: "web" });
    const worker = TestFixture.container({ name: "worker" });

    // when
    await write([
      ...Array.from({ length: 50 }, () => TestFixture.logEvent({ container: web })),
      ...Array.from({ length: 50 }, () => TestFixture.logEvent({ container: worker })),
    ]);
    // then
    expect(await containers()).toEqual([web, worker]);
    expect((await repository.listEvents(web.id, 1_000)).events).toHaveLength(50);
    expect((await repository.listEvents(worker.id, 1_000)).events).toHaveLength(50);
  });

  it("should record the newest timestamp in a batch as when a container was last seen", async () => {
    // given (one batch spanning a minute -- upserting once per container must not keep the first)
    const container = TestFixture.container();
    const at = (iso: string) => ({ ...TestFixture.logEvent({ container }), timestamp: Temporal.Instant.from(iso) });

    // when
    await write([at("2026-08-03T12:00:00Z"), at("2026-08-03T12:00:30Z"), at("2026-08-03T12:01:00Z")]);
    // then
    const [recorded] = await repository.listContainers();
    expect(recorded?.lastSeen.toString()).toEqual("2026-08-03T12:01:00Z");
  });

  it("should keep a container's identity current across batches", async () => {
    // given (a container is renamed, or joins a compose project, between batches)
    const before = TestFixture.container({ name: "old-name" });
    const after = { ...before, name: "new-name", group: "shop" };

    // when
    await write([TestFixture.logEvent({ container: before })]);
    await write([TestFixture.logEvent({ container: after })]);
    // then (still one row, carrying the latest identity)
    expect(await containers()).toEqual([after]);
  });

  it("should keep only the newest events per container, independently of each other", async () => {
    // given (one chatty container and one quiet one)
    const chatty = TestFixture.container({ name: "chatty" });
    const quiet = TestFixture.container({ name: "quiet" });
    await write([
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
    await write(Array.from({ length: 5 }, () => TestFixture.logEvent({ container })));

    // when
    const pruned = await repository.pruneToEventsPerContainer(10);
    // then
    expect(pruned.events).toEqual(0);
    expect((await repository.listEvents(container.id, 1_000)).events).toHaveLength(5);
  });

  it("should do nothing while the database fits the budget", async () => {
    // given
    const container = TestFixture.container();
    await write(Array.from({ length: 10 }, () => TestFixture.logEvent({ container })));

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
    await write([TestFixture.logEvent({ container: gone, line: "goodbye" })]);
    // more than one prune chunk, so that some of them survive it
    await write(Array.from({ length: 15_000 }, (_, i) => TestFixture.logEvent({ container: staying, line: `line ${i} `.repeat(30) })));

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
    await write([TestFixture.logEvent({ container })]);
    await write([TestFixture.logEvent({ container })]);
    await write([TestFixture.logEvent({ container })]);
    // then (the seed, plus one emission for the container appearing -- not one per batch)
    expect(published).toEqual([[], [container]]);
  });

  /** The overview the repository publishes, which is always current after a mutation. */
  async function containers(): Promise<Container[]> {
    return await firstValueFrom(repository.streamContainers());
  }

  /**
   * Stands in for the tick the repository flushes on, so writing is deterministic rather than a
   * second away. The insert itself has already happened by the time `next` returns -- the wait is
   * for the bookkeeping that follows it, which settles a microtask later.
   */
  async function flush(): Promise<void> {
    context.flushTrigger.next();
    await Bun.sleep(0);
  }

  /** Writing is a buffer plus a flush; tests that only care about the result say so in one line. */
  async function write(events: ContainerEvent[]): Promise<void> {
    events.forEach((event) => repository.saveEvent(event));
    await flush();
  }
});
