import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { Temporal } from "@js-temporal/polyfill";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { LogPattern } from "@/models/LogPattern";
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
    const { data } = await repository.listEvents(container.id, 100);
    expect(data.map(({ type }) => type)).toEqual([
      ContainerEvent.Type.start,
      ContainerEvent.Type.log,
      ContainerEvent.Type.log,
      ContainerEvent.Type.log_throttle,
      ContainerEvent.Type.stop,
    ]);
    expect(data.at(1)).toEqual(
      expect.objectContaining({ line: "GET / 200", streamVariant: StreamVariant.stdout } satisfies Partial<ContainerEvent>),
    );
    expect(data.at(2)).toEqual(expect.objectContaining({ streamVariant: StreamVariant.stderr } satisfies Partial<ContainerEvent>));
    expect(data.at(3)).toEqual(expect.objectContaining({ foldCount: 12 } satisfies Partial<ContainerEvent>));
    expect(data.at(1)?.container).toEqual(container);
  });

  it("should answer with events that have been recorded but not yet written", async () => {
    // given (nothing has been flushed, so the database is still empty)
    const container = TestFixture.container();
    repository.saveEvent(TestFixture.logEvent({ container, line: "not on disk yet" }));

    // when
    const { data } = await repository.listEvents(container.id, 100);
    // then
    expect(data.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["not on disk yet"]);

    // and the same events are not served twice once they do land
    await flush();
    const { data: afterFlush } = await repository.listEvents(container.id, 100);
    expect(afterFlush).toHaveLength(1);
  });

  it("should join written and unwritten events into one uninterrupted page", async () => {
    // given (half written, half still buffered -- the seam the reader must not see)
    const { container, all } = await tenLinesHalfBuffered();

    // when
    const { data } = await repository.listEvents(container.id, 100);
    // then
    expect(data.map((event) => event.id)).toEqual(all.map((event) => event.id));
  });

  /**
   * Both halves are asked the same question here: the fixture leaves five lines on disk and five in
   * the buffer, so a cursor that meant something slightly different to the query than to the
   * predicate would show up as a page with a join in it.
   */
  const CURSOR_CASES: Array<{
    name: string;
    cursor: (all: ContainerEvent[]) => EventRepository.Cursor;
    expected: (all: ContainerEvent[]) => ContainerEvent[];
  }> = [
    {
      name: "everything older than a line that is itself still buffered",
      cursor: (all) => ({ before: all[7]!.id, beforeInclusivity: "exclusive" }),
      expected: (all) => all.slice(0, 7),
    },
    {
      name: "everything newer than a line still on disk, on into the part that is not",
      cursor: (all) => ({ after: all[2]!.id, afterInclusivity: "exclusive" }),
      expected: (all) => all.slice(3),
    },
  ];

  for (const { name, cursor, expected } of CURSOR_CASES) {
    it(`should honour a cursor across both halves: ${name}`, async () => {
      // given
      const { container, all } = await tenLinesHalfBuffered();
      // when
      const { data } = await repository.listEvents(container.id, 100, cursor(all));
      // then (nothing at the cursor itself, and nothing beyond it in the other direction)
      expect(data.map((event) => event.id)).toEqual(expected(all).map((event) => event.id));
    });
  }

  /**
   * What a page says about its own edges, read forwards from a cursor.
   *
   * The last case is the one worth keeping honest: a page that filled and a page that filled *and
   * finished* look identical from the row count alone, which is why one row beyond the page is
   * asked for. Having it is the only way to tell "cut short" from "ended here".
   */
  const PAGING_CASES: Array<{
    name: string;
    limit: number;
    fromIndex: number;
    expectedLines: string[];
    hasNewer: boolean;
    hasOlder: boolean;
  }> = [
    {
      name: "reading on from a cursor takes the oldest of what lies ahead, not the newest",
      limit: 3,
      fromIndex: 0,
      expectedLines: ["line 1", "line 2", "line 3"],
      hasNewer: true,
      hasOlder: true,
    },
    {
      name: "a window wider than what remains reaches the end of the log",
      limit: 100,
      fromIndex: 7,
      expectedLines: ["line 8", "line 9"],
      hasNewer: false,
      hasOlder: true,
    },
    {
      name: "a page landing exactly on the end of the log does not claim there is more",
      limit: 9,
      fromIndex: 0,
      expectedLines: Array.from({ length: 9 }, (_, i) => `line ${i + 1}`),
      hasNewer: false,
      hasOlder: true,
    },
  ];

  for (const { name, limit, fromIndex, expectedLines, hasNewer, hasOlder } of PAGING_CASES) {
    it(`should report its edges when reading forwards: ${name}`, async () => {
      // given
      const { container, all } = await tenWrittenLines();
      // when
      const page = await repository.listEvents(container.id, limit, { after: all[fromIndex]!.id, afterInclusivity: "exclusive" });
      // then
      expect(page.data.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(expectedLines);
      expect(page.hasNewer).toBe(hasNewer);
      expect(page.hasOlder).toBe(hasOlder);
    });
  }

  /**
   * `hasNewer` runs out at the top of the *window*; the feed is a different edge. They agree only
   * while the window is still open at the top, and reading one for the other is what puts a line
   * from today underneath one from yesterday.
   */
  const LIVE_FEED_CASES: Array<{
    name: string;
    limit?: number;
    cursor?: (all: ContainerEvent[]) => EventRepository.Cursor;
    filter?: () => EventRepository.Filter;
    hasNewer: boolean;
    hasOlder?: boolean;
    reachesLiveFeed: boolean;
  }> = [
    {
      name: "a window with no end at all, which is where a page opens with nothing in its url",
      hasNewer: false,
      hasOlder: false,
      reachesLiveFeed: true,
    },
    {
      // out of window and out of feed are not the same thing, and only the second is reported here
      name: "a window closed in the past runs out without ever arriving at the feed",
      filter: () => ({ until: Temporal.Now.instant() }),
      hasNewer: false,
      reachesLiveFeed: false,
    },
    {
      // an end was named, but the feed is comfortably inside it -- a named end is not a closed one
      name: "a window closed in the future still contains the feed",
      filter: () => ({ until: Temporal.Now.instant().add({ hours: 24 }) }),
      hasNewer: false,
      reachesLiveFeed: true,
    },
    {
      name: "a window parked in history has the feed somewhere above it",
      limit: 3,
      cursor: (all) => ({ before: all[8]!.id, beforeInclusivity: "exclusive" }),
      hasNewer: true,
      reachesLiveFeed: false,
    },
  ];

  for (const { name, limit, cursor, filter, hasNewer, hasOlder, reachesLiveFeed } of LIVE_FEED_CASES) {
    it(`should tell the window's end apart from the live feed: ${name}`, async () => {
      // given
      const { container, all } = await tenWrittenLines();
      // when
      const page = await repository.listEvents(container.id, limit ?? 100, cursor?.(all) ?? {}, filter?.() ?? {});
      // then
      expect(page.hasNewer).toBe(hasNewer);
      expect(page.reachesLiveFeed).toBe(reachesLiveFeed);
      if (hasOlder !== undefined) {
        expect(page.hasOlder).toBe(hasOlder);
      }
    });
  }

  it("should report reaching the beginning when reading forwards from before anything was logged", async () => {
    // given
    const { container } = await tenWrittenLines();

    // when (arriving by time, at an instant older than every line there is)
    const beforeEverything = Uuid.fromBytes(Uuid.lowerBoundAt(Temporal.Instant.from("2000-01-01T00:00:00Z")));
    const page = await repository.listEvents(container.id, 100, { after: beforeEverything, afterInclusivity: "exclusive" });

    // then (the whole history, and no pretending there is more above it)
    expect(page.data).toHaveLength(10);
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

    /**
     * Where a search starts from, and whether the line it starts on may answer. The anchor is the
     * only thing that varies: the needle and the haystack are the same throughout, so a wrong
     * result here is always a statement about inclusivity or direction.
     */
    const ANCHOR_CASES: Array<{
      name: string;
      anchorIndex?: number;
      anchorInclusivity?: "inclusive" | "exclusive";
      direction: Direction;
      expectedIndex: number;
    }> = [
      {
        name: "with nothing to start from, the nearest match below -- not the furthest",
        direction: Direction.forwards_in_time,
        expectedIndex: 2,
      },
      {
        name: "standing at the very end and stepping back, 7 rather than 2",
        anchorIndex: 9,
        anchorInclusivity: "inclusive",
        direction: Direction.backwards_in_time,
        expectedIndex: 7,
      },
      {
        name: "stepping off a match it is standing on, rather than returning it forever",
        anchorIndex: 2,
        anchorInclusivity: "exclusive",
        direction: Direction.forwards_in_time,
        expectedIndex: 7,
      },
      {
        name: "an anchor the reader merely happened to be looking at may match on its own",
        anchorIndex: 2,
        anchorInclusivity: "inclusive",
        direction: Direction.forwards_in_time,
        expectedIndex: 2,
      },
    ];

    for (const { name, anchorIndex, anchorInclusivity, direction, expectedIndex } of ANCHOR_CASES) {
      it(`should search out from where it was told to: ${name}`, async () => {
        // given
        const { container, all } = await haystack();
        // when
        const found = await repository.findEvent(container.id, {
          logPattern: { pattern: "needle", patternVariant: LogPattern.Variant.substr },
          anchorId: anchorIndex === undefined ? undefined : all[anchorIndex]!.id,
          anchorInclusivity,
          direction,
        });
        // then
        expect(found.id).toBe(all[expectedIndex]!.id);
      });
    }

    it("should answer with nothing when the needle is not there, rather than guessing", async () => {
      // given
      const { container } = await haystack();
      // when
      const found = await repository.findEvent(container.id, {
        logPattern: { pattern: "haystack", patternVariant: LogPattern.Variant.substr },
        direction: Direction.forwards_in_time,
      });
      // then
      expect(found.id).toBeUndefined();
    });

    it("should ignore case for a literal needle, and take a regular expression as written", async () => {
      // given
      const container = TestFixture.container();
      const all = [TestFixture.logEvent({ container, line: "SHOUTING" })];
      await write(all);

      // when / then
      const substr = LogPattern.Variant.substr;
      const regex = LogPattern.Variant.regex;
      const literal = { logPattern: { pattern: "shouting", patternVariant: substr }, direction: Direction.forwards_in_time } as const;
      expect((await repository.findEvent(container.id, literal)).id).toBe(all[0]!.id);
      expect(
        (await repository.findEvent(container.id, { ...literal, logPattern: { pattern: "shout.ng", patternVariant: regex } })).id,
      ).toBeUndefined();
      expect(
        (await repository.findEvent(container.id, { ...literal, logPattern: { pattern: "SHOUT.NG", patternVariant: regex } })).id,
      ).toBe(all[0]!.id);
    });

    it("should not let sqlite's own wildcards leak out of a literal needle", async () => {
      // given (a needle whose characters mean something to `like`)
      const container = TestFixture.container();
      const all = [TestFixture.logEvent({ container, line: "100% done" }), TestFixture.logEvent({ container, line: "100 percent" })];
      await write(all);

      // when
      const found = await repository.findEvent(container.id, {
        logPattern: { pattern: "100%", patternVariant: LogPattern.Variant.substr },
        direction: Direction.forwards_in_time,
      });
      // then (the literal "100%", not "100" followed by anything)
      expect(found.id).toBe(all[0]!.id);
    });

    it("should search lines that have not been written yet", async () => {
      // given (half on disk, half still buffered)
      const container = TestFixture.container();
      await write([TestFixture.logEvent({ container, line: "line 0" })]);
      const unwritten = TestFixture.logEvent({ container, line: "needle in the buffer" });
      repository.saveEvent(unwritten);

      // when
      const found = await repository.findEvent(container.id, {
        logPattern: { pattern: "needle", patternVariant: LogPattern.Variant.substr },
        direction: Direction.forwards_in_time,
      });
      // then
      expect(found.id).toBe(unwritten.id);
    });

    it("should finish a walk that crosses chunks from an inclusive anchor and matches nothing", async () => {
      /**
       * The tail of the walk is the part worth guarding. Resuming a chunk means resuming *from* the
       * last row read, so that row has to be excluded or the final chunk comes back holding only it
       * -- never empty, never advancing. A regular expression is what reaches that tail at all: a
       * literal is handed to `like`, which empties the query long before the end of the range.
       */
      const container = TestFixture.container();
      const CHUNK = 1_000;
      const all = Array.from({ length: CHUNK + 1 }, (_, index) => TestFixture.logEvent({ container, line: `line ${index}` }));
      await write(all);

      // when (anchored on the very first line, and inclusive of it)
      const found = await repository.findEvent(container.id, {
        logPattern: { pattern: "nothing-matches-this", patternVariant: LogPattern.Variant.regex },
        anchorId: all[0]!.id,
        anchorInclusivity: "inclusive",
        direction: Direction.forwards_in_time,
      });
      // then (it ends, rather than spinning on the last row for ever)
      expect(found.id).toBeUndefined();
    });
  });

  describe("literal needles", () => {
    /**
     * A literal needle is answered by sqlite's `like` for rows on disk and by the predicate for rows
     * still buffered, so the two have to reach the same verdict on every input -- not merely on the
     * ascii ones. These are the pairs where folding rules diverge: accented letters, a dotted
     * capital `İ` that javascript lowers to an `i`, a final sigma, a ligature, full-width latin.
     */
    const PAIRS: Array<{ line: string; needle: string; matches: boolean }> = [
      { line: "Cafe latte", needle: "cafe", matches: true },
      { line: "CAFE LATTE", needle: "cafe", matches: true },
      { line: "GET /api", needle: "get /API", matches: true },
      { line: "100% done", needle: "100%", matches: true },
      { line: "café latte", needle: "café", matches: true },
      { line: "café latte", needle: "CAFÉ", matches: false },
      { line: "CAFÉ LATTE", needle: "café", matches: false },
      { line: "İstanbul", needle: "i", matches: false },
      { line: "ΣΙΓΜΑ", needle: "σιγμα", matches: false },
      { line: "straße", needle: "STRASSE", matches: false },
      { line: "ﬁle", needle: "fi", matches: false },
      { line: "ＡＢＣ", needle: "abc", matches: false },
    ];

    it.each(PAIRS)("should agree on $needle against $line, on disk and in the buffer", async ({ line, needle, matches }) => {
      // given (the same line written to one container and left buffered in another)
      const written = TestFixture.container({ name: "written" });
      const buffered = TestFixture.container({ name: "buffered" });
      await write([TestFixture.logEvent({ container: written, line })]);
      repository.saveEvent(TestFixture.logEvent({ container: buffered, line }));
      const logPattern = { pattern: needle, patternVariant: LogPattern.Variant.substr };

      // when (sqlite answers for the first, the predicate for the second)
      const fromDisk = await repository.listEvents(written.id, 100, {}, { logPattern });
      const fromBuffer = await repository.listEvents(buffered.id, 100, {}, { logPattern });

      // then (one verdict, whichever half is asked)
      expect(fromDisk.data.length).toBe(matches ? 1 : 0);
      expect(fromBuffer.data.length).toBe(matches ? 1 : 0);
      expect(LogPattern.predicate(logPattern)(line)).toBe(matches);
    });
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
    expect((await repository.listEvents(container.id, 100)).data).toHaveLength(1);
    transaction.mockRestore();
    await flush();
    expect((await repository.listEvents(container.id, 100)).data).toHaveLength(1);
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
    const { data: events } = await repository.listEvents(container.id, 100);
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
    expect((await repository.listEvents(web.id, 1_000)).data).toHaveLength(50);
    expect((await repository.listEvents(worker.id, 1_000)).data).toHaveLength(50);
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
    expect((await repository.listEvents(quiet.id, 1_000)).data).toHaveLength(3);
    const { data: remaining } = await repository.listEvents(chatty.id, 1_000);
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
    expect((await repository.listEvents(container.id, 1_000)).data).toHaveLength(5);
  });

  it("should do nothing while everything is inside the window", async () => {
    // given
    const container = TestFixture.container();
    await write(Array.from({ length: 10 }, () => TestFixture.logEvent({ container })));

    // when
    const pruned = await repository.pruneEventsOlderThan(Temporal.Now.instant().subtract({ hours: 24 }));
    // then
    expect(pruned).toEqual({ eventDeleteCount: 0, containerDeleteCount: 0 });
    expect((await repository.listEvents(container.id, 1_000)).data).toHaveLength(10);
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
      ...Array.from({ length: 10_050 }, (_, i) => aged(staying, longAgo.add({ seconds: i }), `old ${i}`)),
      ...Array.from({ length: 10 }, (_, i) => aged(staying, yesterday.add({ seconds: i }), `recent ${i}`)),
    ]);

    // when
    const pruned = await repository.pruneEventsOlderThan(Temporal.Now.instant().subtract({ hours: 24 * 30 }));
    // then
    expect(pruned.eventDeleteCount).toEqual(10_051);
    expect(pruned.containerDeleteCount).toEqual(1);
    expect(await containers()).toEqual([staying]);
    // only what fell inside the window survived
    const { data: remaining } = await repository.listEvents(staying.id, 100_000);
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

  /** "line 0" .. "line 9", all of them written. */
  async function tenWrittenLines(): Promise<{ container: Container; all: ContainerEvent[] }> {
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await write(all);
    return { container, all };
  }

  /** The same ten, with the second half left in the buffer -- the seam a page must not show. */
  async function tenLinesHalfBuffered(): Promise<{ container: Container; all: ContainerEvent[] }> {
    const container = TestFixture.container();
    const all = Array.from({ length: 10 }, (_, i) => TestFixture.logEvent({ container, line: `line ${i}` }));
    await write(all.slice(0, 5));
    all.slice(5).forEach((event) => repository.saveEvent(event));
    return { container, all };
  }

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
