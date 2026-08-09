import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEventConverter } from "@/drizzle/converters/ContainerEventConverter";
import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { LogLinePattern } from "@/models/LogLinePattern";
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, BinaryOperator, desc, eq, gt, gte, lt, lte, notExists, SQL, sql } from "drizzle-orm";
import { BehaviorSubject, catchError, concatMap, defer, EMPTY, interval, Observable } from "rxjs";

/**
 * Recent events are held in a `pending` memory buffer until they are flushed
 */
export class EventRepository {
  private readonly log = new Logger(__filename);
  private readonly containers = new BehaviorSubject<Container[]>([]);

  private readonly FLUSH_INTERVAL = Temporal.Duration.from({ seconds: 1 });
  private pending: ContainerEvent[] = [];
  private failedFlushes = 0;

  public constructor(
    private readonly sqlite: Sqlite,
    private readonly flushTrigger: Observable<unknown> = interval(this.FLUSH_INTERVAL.total("milliseconds")), // overridable for unit tests
  ) {}

  public streamContainers(): Observable<Container[]> {
    return this.containers;
  }

  public async listContainers(): Promise<{ container: Container; firstSeen: Temporal.Instant; lastSeen: Temporal.Instant }[]> {
    const rows = this.sqlite.select().from($container).orderBy(desc($container.lastSeen)).all();
    return rows.map((row) => ({
      container: ContainerEventConverter.containerFromDatabase(row),
      firstSeen: Temporal.Instant.from(row.firstSeen),
      lastSeen: Temporal.Instant.from(row.lastSeen),
    }));
  }

  /**
   * Also manually invoked after every write, so the overview reflects containers that have only just appeared
   */
  @Initialize
  public publishContainers(): void {
    const rows = this.sqlite.select().from($container).orderBy(asc($container.name)).all();
    const containers = rows.map((row) => ContainerEventConverter.containerFromDatabase(row));
    const previous = this.containers.value;
    const unchanged =
      previous.length === containers.length &&
      previous.every((was, index) => {
        const now = containers[index]!;
        return was.id === now.id && was.name === now.name && was.group === now.group;
      });
    if (!unchanged) {
      this.containers.next(containers);
    }
  }

  public saveEvent(event: ContainerEvent): void {
    this.pending.push(event);
    this.enforcePendingCeiling();
  }

  public async findEvent(dockerId: string, search: EventRepository.Search, filter: EventRepository.Filter = {}): Promise<string | null> {
    const searchPredicate = Internal.searchPredicate(search);
    const filterPredicate = Internal.filterPredicate(filter);

    //
    // Part A: search the buffer for a candidate
    //
    const bufferMatchesBeyondSearchAnchor = this.pending
      .filter((event): event is ContainerEvent.Log => event.container.id === dockerId && event.type === ContainerEvent.Type.log)
      .filter((event) => searchPredicate.fullInMemoryTest(event)) // only logs matching the specific search constraints...
      .filter((event) => filterPredicate.fullInMemoryTest(event)) // ...but only if they match the general filter window as well
      .map((event) => event.id)
      .sort(); // UUIDv7s
    const bufferMatch = search.direction === "up" ? bufferMatchesBeyondSearchAnchor.at(-1) : bufferMatchesBeyondSearchAnchor.at(0);

    //
    // Part B: search the database for a candidate
    //
    const CHUNK = 1_000;
    const upDirection = search.direction === "up";
    const container = this.sqlite.select().from($container).where(eq($container.dockerId, dockerId)).get();
    if (!container) {
      return bufferMatch ?? null; // nothing was ever flushed, so the buffer contains all history
    }

    // the anchor opens the walk; every chunk after it resumes from the last row already read
    let cursor = search.anchorId;
    while (true) {
      const chunk = this.sqlite
        .select({ id: $containerEvent.id, line: $containerEvent.line })
        .from($containerEvent)
        .where(
          and(
            eq($containerEvent.containerId, container.id),
            ...searchPredicate.partialDatabaseTest(cursor), // only logs matching the specific search constraints...
            ...filterPredicate.partialDatabaseTest(), // ...but only if they match the general filter window as well
          ),
        )
        .orderBy(upDirection ? desc($containerEvent.id) : asc($containerEvent.id))
        .limit(CHUNK)
        .all();
      if (chunk.length === 0) {
        break;
      }

      for (const row of chunk) {
        const databaseCandidate: Internal.Candidate = {
          id: Uuid.fromBytes(row.id),
          line: row.line,
        };
        if (searchPredicate.fullInMemoryTest(databaseCandidate) && filterPredicate.fullInMemoryTest(databaseCandidate)) {
          const databaseMatch = databaseCandidate.id;

          //
          // Part C: compare both matches
          //
          if (!bufferMatch) {
            return databaseMatch;
          }
          switch (search.direction) {
            case "up":
              return bufferMatch > databaseMatch ? bufferMatch : databaseMatch;
            case "down":
              return bufferMatch < databaseMatch ? bufferMatch : databaseMatch;
          }
        }
      }
      cursor = Uuid.fromBytes(chunk.at(-1)!.id);
    }

    // no database match, so the buffer match is our best (and only) candidate ...
    return bufferMatch ?? null;
  }

  public async listEvents(
    dockerId: string,
    limit: number,
    cursor: EventRepository.Cursor = {},
    filter: EventRepository.Filter = {},
  ): Promise<EventRepository.Page> {
    const direction: Internal.Direction = cursor.after !== undefined ? "forwards_in_time" : "backwards_in_time";
    const dbContainer = this.sqlite.select().from($container).where(eq($container.dockerId, dockerId)).get();

    const cursorPredicate = Internal.cursorPredicate(cursor);
    const filterPredicate = Internal.filterPredicate(filter);

    /**
     * A container with nothing flushed yet has no row, and that is ordinary rather than exceptional:
     * events are buffered for up to a flush before one exists. Only this half needs the row -- a
     * buffered event carries its own container -- so the read is skipped rather than the request
     * refused, and the model is built where the row is known to be there.
     */
    let dbEvents: ContainerEvent[] = [];
    if (dbContainer) {
      const container = ContainerEventConverter.containerFromDatabase(dbContainer);
      dbEvents = this.queryEventsUpToLimitWithPredicate({
        limit,
        direction,
        where: and(
          eq($containerEvent.containerId, dbContainer.id),
          ...cursorPredicate.fullDatabaseTest(), // only logs matching the specific cursor constraints...
          ...filterPredicate.partialDatabaseTest(), // ...but only if they match the general filter window as well
        ),
        predicate: filterPredicate.fullInMemoryTest,
        mapper: (row) => ContainerEventConverter.fromDatabase(row, container),
      });
    }
    const bufferEvents = this.pending
      .filter((event): event is ContainerEvent.Log => event.container.id === dockerId && event.type === ContainerEvent.Type.log)
      .filter((event) => cursorPredicate.fullInMemoryTest(event)) // only logs matching the specific cursor constraints...
      .filter((event) => filterPredicate.fullInMemoryTest(event)); // ...but only if they match the general filter window as well

    // Deduplicate events by id
    const events = [...new Map([...dbEvents, ...bufferEvents].map((event) => [event.id, event])).values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    const saturated = dbEvents.length === limit || events.length > limit;
    const page = direction === "forwards_in_time" ? events.slice(0, limit) : events.slice(-limit);
    return {
      events: page,
      /**
       * Reading forwards leaves the older side unexamined, and it used to be *assumed* to have more.
       * That is wrong in the one place it matters: arriving at a time before anything was logged, the
       * reader is standing at the beginning of history and needs to be told so. One indexed existence
       * check answers it instead of guessing.
       */
      hasOlder:
        direction === "forwards_in_time" ? this.anythingOlderThan(dbContainer?.id, page.at(0)?.id, cursor.after, filter) : saturated,
      hasNewer: direction === "forwards_in_time" ? saturated : cursor.before !== undefined,
    };
  }

  private queryEventsUpToLimitWithPredicate<T = typeof $containerEvent.$inferSelect>({
    where,
    direction,
    limit,
    predicate,
    mapper = (x) => x as T,
  }: {
    where: ReturnType<typeof and>;
    direction: Internal.Direction;
    limit: number;
    predicate?: (candidate: Internal.Candidate) => boolean;
    mapper?: (from: typeof $containerEvent.$inferSelect) => T;
  }): Array<T> {
    const CHUNK = 1_000;
    const towardsFuture = direction === "forwards_in_time";
    const order = towardsFuture ? asc($containerEvent.id) : desc($containerEvent.id);
    const query = (extra: ReturnType<typeof and>, take: number) =>
      this.sqlite.select().from($containerEvent).where(and(where, extra)).orderBy(order).limit(take).all();

    if (!predicate) {
      return query(undefined, limit).map(mapper);
    }
    const collected: ReturnType<typeof query> = [];
    let cursor: Buffer | undefined;
    while (collected.length < limit) {
      const chunk = query(cursor === undefined ? undefined : (towardsFuture ? gt : lt)($containerEvent.id, cursor), CHUNK);
      if (chunk.length === 0) {
        break;
      }
      for (const row of chunk) {
        if (collected.length < limit && predicate({ id: Uuid.fromBytes(row.id), line: row.line })) {
          collected.push(row);
        }
      }
      cursor = chunk.at(-1)!.id as Buffer;
    }
    return collected.map(mapper);
  }

  /**
   * Whether the container holds anything above the page just read. The page's own oldest line is the
   * bound when there is one; with an empty page everything up to and including the cursor qualifies,
   * since nothing beyond it exists to have pushed it along.
   */
  private anythingOlderThan(
    container: number | undefined,
    oldestShown: string | undefined,
    cursor: string | undefined,
    filter: EventRepository.Filter,
  ): boolean {
    const bound =
      oldestShown !== undefined
        ? lt($containerEvent.id, Uuid.toBytes(oldestShown))
        : cursor !== undefined
          ? lte($containerEvent.id, Uuid.toBytes(cursor))
          : undefined;
    // nothing is written for this container yet, so nothing can be older than the page
    if (container === undefined || !bound) {
      return false;
    }
    /**
     * Under a filter this stops being a free existence check: "is there anything above" becomes "is
     * there another *match* above", which is the same walk the page does, stopped at one.
     */
    const filterPredicate = Internal.filterPredicate(filter);
    return (
      this.queryEventsUpToLimitWithPredicate({
        limit: 1,
        direction: "backwards_in_time",
        where: and(eq($containerEvent.containerId, container), bound, ...filterPredicate.partialDatabaseTest()),
        predicate: filterPredicate.fullInMemoryTest,
      }).length > 0
    );
  }

  @Initialize
  public flushPeriodically(): void {
    this.flushTrigger
      .pipe(
        // `concatMap` keeps writes in order and stops them overlapping: the next flush waits for the
        // current one to land. `defer` matters here: without it `flush` would be called once up
        // front, and a re-subscription would await a promise that had already settled
        concatMap(() =>
          defer(() => this.flush()).pipe(
            // Failing is not allowed to error the stream. Left unhandled it would end this
            // subscription silently, and writing would simply stop. There is no `retry` here on
            // purpose: the next tick is the retry, and the events are still buffered for it
            catchError((error) => {
              this.log.error("Could not flush; trying again on the next tick", error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe({
        error: (error) => this.log.error("Stopped writing buffered events", error),
      });
  }

  private async flush(): Promise<void> {
    const GIVE_UP_AFTER_FLUSHES = 5;
    if (this.pending.length === 0) {
      return;
    }

    const batch = this.pending;
    this.pending = [];
    try {
      await this.batchInsert(batch);
      this.failedFlushes = 0;
    } catch (error) {
      this.failedFlushes += 1;
      if (this.failedFlushes < GIVE_UP_AFTER_FLUSHES) {
        this.pending = batch.concat(this.pending);
        this.enforcePendingCeiling();
      } else {
        this.failedFlushes = 0;
        this.log.error(`Gave up on ${batch.length} events after ${GIVE_UP_AFTER_FLUSHES} failed flushes; discarding them`, error);
      }
      throw error;
    }
  }

  private enforcePendingCeiling(): void {
    const PENDING_CEILING = 50_000;
    if (this.pending.length <= PENDING_CEILING) {
      return;
    }
    const toBeDiscarded = this.pending.length - PENDING_CEILING;
    this.pending = this.pending.slice(toBeDiscarded); // FIFO buffer
    this.log.error(`Discarded ${toBeDiscarded} unwritten events; the buffer is full at ${PENDING_CEILING}`);
  }

  private async batchInsert(events: ContainerEvent[]): Promise<void> {
    const INSERT_CHUNK = 1_000;

    if (events.length === 0) {
      return;
    }
    this.sqlite.transaction((tx) => {
      const distinct = new Map<string, { container: Container; seen: string }>();
      for (const { container, timestamp } of events) {
        distinct.set(container.id, { container, seen: timestamp.toString() });
      }
      const ids = new Map<string, number>();
      const containerRows = [...distinct.values()].map(({ container, seen }) => ({
        dockerId: container.id,
        name: container.name,
        groupName: container.group ?? null,
        firstSeen: seen,
        lastSeen: seen,
      }));
      for (let offset = 0; offset < containerRows.length; offset += INSERT_CHUNK) {
        tx.insert($container)
          .values(containerRows.slice(offset, offset + INSERT_CHUNK))
          // `excluded` is the row we tried to insert, so one statement carries a different name and
          // timestamp for every container. `firstSeen` is left alone: it is only true of the insert
          .onConflictDoUpdate({
            target: $container.dockerId,
            set: { name: sql`excluded.name`, groupName: sql`excluded.group_name`, lastSeen: sql`excluded.last_seen` },
          })
          // returned in no guaranteed order, so the docker id comes back too rather than being positional
          .returning({ id: $container.id, dockerId: $container.dockerId })
          .all()
          .forEach((row) => ids.set(row.dockerId, row.id));
      }

      // Split across statements, because SQLite caps how many values one statement may bind and a
      // single insert of the whole batch would blow past it. Still one transaction, so the batch
      // remains all-or-nothing.
      const rows = events.map((event) => ContainerEventConverter.toDatabase(event, ids.get(event.container.id)!));
      for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
        tx.insert($containerEvent)
          .values(rows.slice(offset, offset + INSERT_CHUNK))
          .run();
      }
    });
    // a write may have introduced a container, or renamed one
    this.publishContainers();
  }

  /**
   * Caps how much history (number of events) any one container may hold
   */
  public async pruneEventsPerContainer(maxEvents: number) {
    const containers = this.sqlite.select({ id: $container.id }).from($container).all();
    let eventDeleteCount = 0;
    for (const { id } of containers) {
      const [surplusCursor] = this.sqlite
        .select({ id: $containerEvent.id })
        .from($containerEvent)
        .where(eq($containerEvent.containerId, id))
        .orderBy(desc($containerEvent.id))
        .limit(1)
        .offset(maxEvents)
        .all();
      if (surplusCursor) {
        const deleted = this.sqlite
          .delete($containerEvent)
          .where(and(eq($containerEvent.containerId, id), lte($containerEvent.id, surplusCursor.id)))
          .returning({ one: sql<number>`1` })
          .all().length;
        eventDeleteCount += deleted;
      }
    }
    return { eventDeleteCount };
  }

  /**
   * Forgets everything older than the cutoff (and drops any container left without events)
   */
  public async pruneEventsOlderThan(cutoff: Temporal.Instant) {
    const CHUNK = 10_000;

    // delete oldest events
    const boundary = Uuid.lowerBoundAt(cutoff);
    let eventDeleteCount = 0;
    for (;;) {
      // a row back per row deleted, since drizzle's driver types away SQLite's rows-affected count.
      // A constant rather than the ids, so a chunk this size is not carried back only to be counted
      const deleted = this.sqlite
        .delete($containerEvent)
        .where(lt($containerEvent.id, boundary))
        .limit(CHUNK)
        .returning({ one: sql<number>`1` })
        .all().length;
      if (deleted > 0) {
        eventDeleteCount += deleted;
        continue;
      }
      break;
    }
    // delete orphaned containers
    const containerDeleteCount = this.deleteContainersWithoutEvents();

    return {
      eventDeleteCount,
      containerDeleteCount,
    };
  }

  private deleteContainersWithoutEvents(): number {
    const deleted = this.sqlite
      .delete($container)
      .where(
        notExists(
          this.sqlite
            .select({ one: sql`1` })
            .from($containerEvent)
            .where(eq($containerEvent.containerId, $container.id)),
        ),
      )
      .returning({ one: sql<number>`1` })
      .all().length;
    // pruning may have purged a container entirely
    this.publishContainers();
    return deleted;
  }
}

/**
 * Each concept owns both halves of itself: the test that decides, and the clauses that narrow what
 * sqlite hands over before it is asked.
 *
 * The contract between the two halves is that `partialDatabaseTest` is a *prefilter*, never the
 * verdict -- it only has to be no stricter than `fullInMemoryTest`. That is what lets a substring
 * narrow the scan while a regular expression, which sqlite cannot evaluate, narrows nothing.
 */
namespace Internal {
  /** Which end of the range a page is filled from, and so which way the rows are read. */
  export type Direction = "forwards_in_time" | "backwards_in_time";

  export type Candidate = {
    id: string;
    line: string | null;
  };

  export function cursorPredicate({ before, beforeInclusivity, after, afterInclusivity }: EventRepository.Cursor): {
    fullDatabaseTest(): Array<SQL<unknown> | undefined>;
    fullInMemoryTest(event: ContainerEvent): boolean;
  } {
    const clauses: Array<SQL<unknown> | undefined> = [];
    if (before) {
      switch (beforeInclusivity) {
        case "exclusive": {
          clauses.push(lt($containerEvent.id, Uuid.toBytes(before)));
          break;
        }
        default:
          throw new Error(`Unsupported inclusivity: ${beforeInclusivity}`);
      }
    }
    if (after) {
      switch (afterInclusivity) {
        case "inclusive":
          clauses.push(gte($containerEvent.id, Uuid.toBytes(after)));
          break;
        case "exclusive":
          clauses.push(gt($containerEvent.id, Uuid.toBytes(after)));
          break;
        default:
          throw new Error(`Unsupported inclusivity: ${afterInclusivity}`);
      }
    }
    return {
      fullDatabaseTest() {
        return clauses;
      },
      fullInMemoryTest(event: ContainerEvent) {
        return (
          (before === undefined || event.id < before) &&
          (after === undefined || (afterInclusivity === "inclusive" ? event.id >= after : event.id > after))
        );
      },
    };
  }

  export function filterBound({ since, until }: Pick<EventRepository.Filter, "since" | "until">) {
    return [
      since === undefined ? undefined : gte($containerEvent.id, Uuid.lowerBoundAt(since)),
      until === undefined ? undefined : lt($containerEvent.id, Uuid.lowerBoundAt(until)),
    ];
  }

  /**
   * The span is compared as *ids*, exactly as {@link filterBound} hands it to sqlite -- a uuidv7 opens with
   * the millisecond, so the comparison the index performs and the one performed here are the same
   * one. Comparing timestamps instead would be a shade more precise on one side than the other, and
   * would cost an `Instant` parse per row on a scan that reads every row in the range.
   */
  export function filterPredicate({ logLinePattern, since, until }: EventRepository.Filter): {
    fullInMemoryTest(candidate: Candidate): boolean;
    partialDatabaseTest(): Array<SQL<unknown> | undefined>;
  } {
    // full in-memory test
    const patternPredicate = logLinePattern ? LogLinePattern.predicate(logLinePattern) : undefined;
    const sinceId = since === undefined ? undefined : Uuid.fromBytes(Uuid.lowerBoundAt(since));
    const untilId = until === undefined ? undefined : Uuid.fromBytes(Uuid.lowerBoundAt(until));
    // partial database test
    const clauses: Array<SQL<unknown> | undefined> = [
      ...Internal.filterBound({ since, until }),
      logLinePattern?.patternVariant === LogLinePattern.Variant.substr ? Internal.sqlContaining(logLinePattern.pattern) : undefined,
    ];
    return {
      fullInMemoryTest(candidate) {
        return (
          (sinceId === undefined || candidate.id >= sinceId) &&
          (untilId === undefined || candidate.id < untilId) &&
          (patternPredicate === undefined || (candidate.line !== null && patternPredicate(candidate.line)))
        );
      },
      partialDatabaseTest() {
        return clauses;
      },
    };
  }

  /**
   * The `like` prefilter for a literal needle, with sqlite's own wildcards defanged.
   *
   * It may stand in for the predicate across every needle because the predicate folds case exactly
   * as `like` does -- see {@link LogLinePattern.predicate}. Were it to fold more, this would become
   * the stricter of the two, and a row rejected here is never carried back to be tested.
   */
  export function sqlContaining(needle: string): SQL<unknown> {
    const escaped = needle.replace(/[\\%_]/g, (character) => `\\${character}`);
    return sql`${$containerEvent.line} like ${`%${escaped}%`} escape '\\'`;
  }

  export function searchPredicate({ logLinePattern, anchorId, anchorInclusivity, direction }: EventRepository.Search): {
    fullInMemoryTest(candidate: Candidate): boolean;
    partialDatabaseTest(cursor: string | undefined): Array<SQL<unknown> | undefined>;
  } {
    const isInclusive = anchorInclusivity === "inclusive";
    // full in-memory test
    const patternPredicate = LogLinePattern.predicate(logLinePattern);
    const beyondPredicate = ({ id }: Candidate): boolean => {
      if (anchorId === undefined) {
        return true;
      }
      if (id === anchorId) {
        return isInclusive;
      }
      switch (direction) {
        case "up":
          return id < anchorId;
        case "down":
          return id > anchorId;
      }
    };
    // partial database test
    const extraClause =
      logLinePattern.patternVariant === LogLinePattern.Variant.substr ? Internal.sqlContaining(logLinePattern.pattern) : undefined;
    return {
      fullInMemoryTest: (candidate) => beyondPredicate(candidate) && candidate.line !== null && patternPredicate(candidate.line),
      partialDatabaseTest: (cursor) => {
        if (cursor === undefined) {
          return [extraClause];
        }
        /**
         * Inclusivity belongs to the anchor, never to a resumption: a walk resuming from the last row
         * it read must exclude it, or it would read that row forever. Rather than have the caller
         * remember to say so, the anchor is recognised here -- any other cursor is a resumption.
         */
        const openingTheWalk = isInclusive && cursor === anchorId;
        let anchorBound: BinaryOperator;
        switch (direction) {
          case "up":
            anchorBound = openingTheWalk ? lte : lt;
            break;
          case "down":
            anchorBound = openingTheWalk ? gte : gt;
            break;
        }
        return [anchorBound($containerEvent.id, Uuid.toBytes(cursor)), extraClause];
      },
    };
  }
}

export namespace EventRepository {
  /**
   * Where to read from. All are ids of events the caller already holds; none means the live end.
   *
   * They are independent bounds rather than a choice of one: `beforeExclusive` alone reads back,
   * a forwards anchor alone reads on from one, and the two together are simply a bounded range.
   * What the combination also settles is the direction -- naming a forwards anchor fills the page
   * from the older end, so it wins over `beforeExclusive` when both are given.
   */
  export type Cursor = {
    /**
     * Reading back only ever starts from a line already in hand, so there is no inclusive form to
     * choose between -- including it would hand the caller a line it is already holding. The name
     * carries that rather than a second field whose only legal value is the one it always has.
     */
    before?: string;
    beforeInclusivity?: "exclusive"; // only allowed variant
    /**
     * Forwards, and inclusive or not. Arriving at a *found* line differs from paging on from one
     * already read: the whole point is to be shown it, so it has to open the window rather than sit
     * just off the top of it.
     */
    after?: string;
    afterInclusivity?: "inclusive" | "exclusive";
  };

  /**
   * The narrowed view everything else operates inside. Absent parts narrow nothing, so `{}` is the
   * whole log.
   *
   * The span is expressed as *ids* rather than timestamps once it reaches sqlite: uuidv7s are
   * time-ordered, so a time range is a key range, and the walk is bounded by the index instead of
   * being filtered after the fact.
   */
  export type Filter = {
    logLinePattern?: LogLinePattern;
    since?: Temporal.Instant;
    until?: Temporal.Instant;
  };

  /**
   * The line to search out from, and whether it may itself be the answer
   */
  export type Search = {
    logLinePattern: LogLinePattern;
    anchorId?: string;
    anchorInclusivity?: "inclusive" | "exclusive";
    direction: "up" | "down";
  };

  export type Page = {
    events: ContainerEvent[];
    hasOlder: boolean;
    hasNewer: boolean; // false means: it reaches the live feed
  };
}
