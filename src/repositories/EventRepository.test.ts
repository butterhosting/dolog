import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { Temporal } from "@js-temporal/polyfill";
import { ContainerEvent } from "@/models/ContainerEvent";
import { LogLinePattern } from "@/models/LogLinePattern";
import { StreamVariant } from "@/models/StreamVariant";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { firstValueFrom } from "rxjs";
import { EventRepository } from "./EventRepository";

describe(EventRepository.name, () => {
  let context: TestEnvironment.Context;
  let repository: EventRepository;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    repository = context.eventRepository;
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
    const { events } = await repository.listEvents(container.id, 100, { before: all[7]!.id });
    // then (everything older, from both halves, and nothing at or after the cursor)
    expect(events.map((event) => event.id)).toEqual(all.slice(0, 7).map((event) => event.id));
  });

  it("should read forwards from a cursor, across both halves", async () => {
    // given
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await write(all.slice(0, 5));
    all.slice(5).forEach((event) => repository.saveEvent(event));

    // when (reading on from an event that is still on disk, into the part that is not)
    const { events } = await repository.listEvents(container.id, 100, { after: all[2]!.id });
    // then (everything newer, from both halves, and nothing at or before the cursor)
    expect(events.map((event) => event.id)).toEqual(all.slice(3).map((event) => event.id));
  });

  it("should take the oldest of what lies ahead when reading forwards, not the newest", async () => {
    // given (a window smaller than what remains, so the direction of the slice shows)
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await write(all);

    // when
    const page = await repository.listEvents(container.id, 3, { after: all[0]!.id });
    // then (the three immediately following the cursor -- reading on, not jumping to the end)
    expect(page.events.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["line 1", "line 2", "line 3"]);
    expect(page.hasNewer).toBe(true);
    expect(page.hasOlder).toBe(true);
  });

  it("should report reaching the live end when reading forwards runs out", async () => {
    // given
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await write(all);

    // when (a window wider than what remains)
    const page = await repository.listEvents(container.id, 100, { after: all[7]!.id });
    // then
    expect(page.events).toHaveLength(2);
    expect(page.hasNewer).toBe(false);
    expect(page.hasOlder).toBe(true);
  });

  it("should report reaching the beginning when reading forwards from before anything was logged", async () => {
    // given
    const container = TestFixture.container();
    await write(Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` })));

    // when (arriving by time, at an instant older than every line there is)
    const beforeEverything = Uuid.fromBytes(Uuid.lowerBoundAt(Temporal.Instant.from("2000-01-01T00:00:00Z")));
    const page = await repository.listEvents(container.id, 100, { after: beforeEverything });

    // then (the whole history, and no pretending there is more above it)
    expect(page.events).toHaveLength(10);
    expect(page.hasOlder).toBe(false);
  });

  describe("searching", () => {
    /** "line 0" .. "line 9", with "needle" buried at 2 and 7. */
    async function haystack() {
      const container = TestFixture.container();
      const all = Array.from({ length: 10 }, (_, i) =>
        TestFixture.logEvent({ container, line: i === 2 || i === 7 ? `needle ${i}` : `line ${i}` }),
      );
      await write(all);
      return { container, all };
    }

    it("should find the nearest match below the anchor, not the furthest", async () => {
      // given
      const { container, all } = await haystack();
      // when
      const found = await repository.findEvent(container.id, {
        logLinePattern: { pattern: "needle", patternVariant: LogLinePattern.Variant.substr },
        direction: "down",
      });
      // then
      expect(found).toBe(all[2]!.id);
    });

    it("should find the nearest match above the anchor when reading up", async () => {
      // given
      const { container, all } = await haystack();
      // when (standing at the very end and stepping back)
      const found = await repository.findEvent(container.id, {
        logLinePattern: { pattern: "needle", patternVariant: LogLinePattern.Variant.substr },
        anchorId: all[9]!.id,
        anchorInclusivity: "inclusive",
        direction: "up",
      });
      // then (7, not 2 -- the first one met going up)
      expect(found).toBe(all[7]!.id);
    });

    it("should step off a match it is standing on rather than returning it forever", async () => {
      // given
      const { container, all } = await haystack();
      // when (anchored on the match at 2, which is how pressing the chevron again arrives here)
      const found = await repository.findEvent(container.id, {
        logLinePattern: { pattern: "needle", patternVariant: LogLinePattern.Variant.substr },
        anchorId: all[2]!.id,
        anchorInclusivity: "exclusive",
        direction: "down",
      });
      // then
      expect(found).toBe(all[7]!.id);
    });

    it("should let an anchor the reader merely happened to be looking at match on its own", async () => {
      // given
      const { container, all } = await haystack();
      // when (the same line, but anchored the way an unmatched viewport edge is)
      const found = await repository.findEvent(container.id, {
        logLinePattern: { pattern: "needle", patternVariant: LogLinePattern.Variant.substr },
        anchorId: all[2]!.id,
        anchorInclusivity: "inclusive",
        direction: "down",
      });
      // then
      expect(found).toBe(all[2]!.id);
    });

    it("should answer with nothing when the needle is not there, rather than guessing", async () => {
      // given
      const { container } = await haystack();
      // when
      const found = await repository.findEvent(container.id, {
        logLinePattern: { pattern: "haystack", patternVariant: LogLinePattern.Variant.substr },
        direction: "down",
      });
      // then
      expect(found).toBeNull();
    });

    it("should ignore case for a literal needle, and take a regular expression as written", async () => {
      // given
      const container = TestFixture.container();
      const all = [TestFixture.logEvent({ container, line: "SHOUTING" })];
      await write(all);

      // when / then
      const substr = LogLinePattern.Variant.substr;
      const regex = LogLinePattern.Variant.regex;
      const literal = { logLinePattern: { pattern: "shouting", patternVariant: substr }, direction: "down" } as const;
      expect(await repository.findEvent(container.id, literal)).toBe(all[0]!.id);
      expect(await repository.findEvent(container.id, { ...literal, logLinePattern: { pattern: "shout.ng", patternVariant: regex } })).toBeNull();
      expect(await repository.findEvent(container.id, { ...literal, logLinePattern: { pattern: "SHOUT.NG", patternVariant: regex } })).toBe(all[0]!.id);
    });

    it("should not let sqlite's own wildcards leak out of a literal needle", async () => {
      // given (a needle whose characters mean something to `like`)
      const container = TestFixture.container();
      const all = [TestFixture.logEvent({ container, line: "100% done" }), TestFixture.logEvent({ container, line: "100 percent" })];
      await write(all);

      // when
      const found = await repository.findEvent(container.id, {
        logLinePattern: { pattern: "100%", patternVariant: LogLinePattern.Variant.substr },
        direction: "down",
      });
      // then (the literal "100%", not "100" followed by anything)
      expect(found).toBe(all[0]!.id);
    });

    it("should search lines that have not been written yet", async () => {
      // given (half on disk, half still buffered)
      const container = TestFixture.container();
      await write([TestFixture.logEvent({ container, line: "line 0" })]);
      const unwritten = TestFixture.logEvent({ container, line: "needle in the buffer" });
      repository.saveEvent(unwritten);

      // when
      const found = await repository.findEvent(container.id, {
        logLinePattern: { pattern: "needle", patternVariant: LogLinePattern.Variant.substr },
        direction: "down",
      });
      // then
      expect(found).toBe(unwritten.id);
    });
  });

  it("should report the live end for a window with no cursor at all", async () => {
    // given
    const container = TestFixture.container();
    await write(Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` })));

    // when
    const page = await repository.listEvents(container.id, 100);
    // then (sitting at the live feed, with nothing below it)
    expect(page.hasNewer).toBe(false);
    expect(page.hasOlder).toBe(false);
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
    const pruned = await repository.pruneEventsPerContainer(10);
    // then (the quiet one is untouched -- its own history is not the chatty one's to spend)
    expect(pruned.eventDeleteCount).toEqual(90);
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
    const pruned = await repository.pruneEventsPerContainer(10);
    // then
    expect(pruned.eventDeleteCount).toEqual(0);
    expect((await repository.listEvents(container.id, 1_000)).events).toHaveLength(5);
  });

  it("should do nothing while everything is inside the window", async () => {
    // given
    const container = TestFixture.container();
    await write(Array.from({ length: 10 }, () => TestFixture.logEvent({ container })));

    // when
    const pruned = await repository.pruneEventsOlderThan(Temporal.Now.instant().subtract({ hours: 24 }));
    // then
    expect(pruned).toEqual({ eventDeleteCount: 0, containerDeleteCount: 0 });
    expect((await repository.listEvents(container.id, 1_000)).events).toHaveLength(10);
  });

  it("should forget events past the window, and containers left with none", async () => {
    // given (`gone` last said anything a year ago; `staying` has old lines and recent ones)
    const gone = TestFixture.container({ name: "gone" });
    const staying = TestFixture.container({ name: "staying" });
    const longAgo = Temporal.Now.instant().subtract({ hours: 24 * 365 });
    const yesterday = Temporal.Now.instant().subtract({ hours: 24 });

    await write([
      aged(gone, longAgo, "goodbye"),
      // more than one prune chunk, so the loop has to go round
      ...Array.from({ length: 15_000 }, (_, i) => aged(staying, longAgo.add({ seconds: i }), `old ${i}`)),
      ...Array.from({ length: 10 }, (_, i) => aged(staying, yesterday.add({ seconds: i }), `recent ${i}`)),
    ]);

    // when
    const pruned = await repository.pruneEventsOlderThan(Temporal.Now.instant().subtract({ hours: 24 * 30 }));
    // then
    expect(pruned.eventDeleteCount).toEqual(15_001);
    expect(pruned.containerDeleteCount).toEqual(1);
    expect(await containers()).toEqual([staying]);
    // only what fell inside the window survived
    const { events: remaining } = await repository.listEvents(staying.id, 100_000);
    expect(remaining).toHaveLength(10);
    expect(remaining.at(0)).toEqual(expect.objectContaining({ line: "recent 0" } satisfies Partial<ContainerEvent>));
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

  /**
   * An event that looks as though it were created then. A uuidv7 opens with the millisecond it was
   * minted, and that is what pruning by age reads, so backdating an event means backdating its id.
   */
  function aged(container: Container, instant: Temporal.Instant, line: string): ContainerEvent {
    const bytes = Uuid.toBytes(Bun.randomUUIDv7()); // random tail, so same-millisecond ids stay distinct
    bytes.writeUIntBE(instant.epochMilliseconds, 0, 6);
    return { ...TestFixture.logEvent({ container, line }), id: Uuid.fromBytes(bytes), timestamp: instant };
  }

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
