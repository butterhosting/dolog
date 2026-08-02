import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { StreamVariant } from "@/models/StreamVariant";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it } from "bun:test";
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
    const stored = await repository.findEvents(container.id, 100);
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
    expect(await repository.findEvents(web.id, 1_000)).toHaveLength(50);
    expect(await repository.findEvents(worker.id, 1_000)).toHaveLength(50);
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

  it("should do nothing while the database fits the budget", async () => {
    // given
    const container = TestFixture.container();
    await repository.append(Array.from({ length: 10 }, () => TestFixture.logEvent({ container })));

    // when
    const pruned = await repository.pruneToSize(64 * 1024 * 1024);
    // then
    expect(pruned).toEqual({ events: 0, containers: 0 });
    expect(await repository.findEvents(container.id, 1_000)).toHaveLength(10);
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

    // when (a budget well under what those events occupy, but above an empty database's floor)
    const pruned = await repository.pruneToSize(3 * 1024 * 1024);
    // then
    expect(pruned.events).toBeGreaterThan(0);
    expect(pruned.containers).toEqual(1);
    expect(await containers()).toEqual([staying]);
    // whatever survived is the newest, so the very first line is long gone
    const remaining = await repository.findEvents(staying.id, 100_000);
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
