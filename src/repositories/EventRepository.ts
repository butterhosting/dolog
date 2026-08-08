import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEventConverter } from "@/drizzle/converters/ContainerEventConverter";
import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { LogLinePattern } from "@/models/LogLinePattern";
import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, BinaryOperator, desc, eq, gt, gte, lt, lte, notExists, sql } from "drizzle-orm";
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

  public saveEvent(event: ContainerEvent): void {
    this.pending.push(event);
    this.enforcePendingCeiling();
  }

  public async listEvents(
    dockerId: string,
    limit: number,
    { before, after, afterInclusive }: EventRepository.Cursor = {},
    filter: EventRepository.Filter = {},
  ): Promise<EventRepository.Page> {
    const forwards = after !== undefined || afterInclusive !== undefined;
    const container = this.sqlite.select().from($container).where(eq($container.dockerId, dockerId)).get();
    const bounds = [
      container ? eq($containerEvent.containerId, container.id) : undefined,
      before === undefined ? undefined : lt($containerEvent.id, Uuid.toBytes(before)),
      after === undefined ? undefined : gt($containerEvent.id, Uuid.toBytes(after)),
      afterInclusive === undefined ? undefined : gte($containerEvent.id, Uuid.toBytes(afterInclusive)),
      ...EventRepository.filterBound(filter),
      // a substring narrows the query itself; a regular expression cannot, and is tested below
      filter.logLinePattern?.patternVariant === "substr" ? EventRepository.containing(filter.logLinePattern.pattern) : undefined,
    ];
    const matches = filter.logLinePattern ? LogLinePattern.predicate(filter.logLinePattern) : undefined;
    const stored = !container
      ? []
      : this.readFiltered(and(...bounds), forwards, limit, filter.logLinePattern?.patternVariant === "regex" ? matches : undefined);

    /**
     * The same filter the query applied, judged here by the same predicate -- so the two halves
     * cannot drift. Only the cursor is restated, since that is the caller's position rather than
     * part of what the window *is*. uuidv7s are time-ordered, so comparing ids as text compares
     * them by age.
     */
    const inWindow = EventRepository.filterPredicate(filter);
    const buffered = this.pending.filter(
      (event) =>
        event.container.id === dockerId &&
        (before === undefined || event.id < before) &&
        (after === undefined || event.id > after) &&
        (afterInclusive === undefined || event.id >= afterInclusive) &&
        // a start or a stop carries no text, so a pattern has nothing in it to match
        inWindow({ id: event.id, line: event.type === ContainerEvent.Type.log ? event.line : null }),
    );
    const model = container ? ContainerEventConverter.containerFromDatabase(container) : undefined;
    const events = [...stored.map((row) => ContainerEventConverter.fromDatabase(row, model!)), ...buffered];

    // A flush landing between the two reads puts the same event in both halves, so they are merged
    // by id rather than concatenated. Sorted rather than assumed ordered for the same reason.
    const merged = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) => a.id.localeCompare(b.id));
    // the query filled its page, or the merge produced more than was asked for, so that edge has more
    const saturated = stored.length === limit || merged.length > limit;
    const page = forwards ? merged.slice(0, limit) : merged.slice(-limit);
    return {
      events: page,
      /**
       * Reading forwards leaves the older side unexamined, and it used to be *assumed* to have more.
       * That is wrong in the one place it matters: arriving at a time before anything was logged, the
       * reader is standing at the beginning of history and needs to be told so. One indexed existence
       * check answers it instead of guessing.
       */
      hasOlder: forwards ? this.anythingOlderThan(container?.id, page.at(0)?.id, after ?? afterInclusive, filter) : saturated,
      hasNewer: forwards ? saturated : before !== undefined,
    };
  }

  /**
   * A page of rows in the direction being read.
   *
   * Without a predicate this is one query: sqlite has applied every condition already, so `limit`
   * means what it says. A regular expression cannot be pushed down, so there `limit` would count
   * rows rather than matches -- the range is walked a chunk at a time instead, and counted here.
   */
  private readFiltered(where: ReturnType<typeof and>, forwards: boolean, limit: number, matches?: (line: string) => boolean) {
    const CHUNK = 1_000;
    const order = forwards ? asc($containerEvent.id) : desc($containerEvent.id);
    const query = (extra: ReturnType<typeof and>, take: number) =>
      this.sqlite.select().from($containerEvent).where(and(where, extra)).orderBy(order).limit(take).all();

    if (!matches) {
      return query(undefined, limit);
    }
    const collected: ReturnType<typeof query> = [];
    let cursor: Buffer | undefined;
    while (collected.length < limit) {
      const chunk = query(cursor === undefined ? undefined : (forwards ? gt : lt)($containerEvent.id, cursor), CHUNK);
      if (chunk.length === 0) {
        break;
      }
      for (const row of chunk) {
        if (collected.length < limit && row.line !== null && matches(row.line)) {
          collected.push(row);
        }
      }
      cursor = chunk.at(-1)!.id as Buffer;
    }
    return collected;
  }

  /**
   * The nearest line matching `needle` in the direction asked for, or null when there is none.
   */
  public async findEvent(dockerId: string, search: EventRepository.Search, filter: EventRepository.Filter = {}): Promise<string | null> {
    const searchPredicate = EventRepository.searchPredicate(search);
    const filterPredicate = EventRepository.filterPredicate(filter);

    //
    // Part A: search the buffer for a candidate
    //
    const bufferMatchesBeyondSearchAnchor = this.pending
      .filter((event): event is ContainerEvent.Log => event.container.id === dockerId && event.type === ContainerEvent.Type.log)
      .filter((event) => searchPredicate(event)) // only logs matching the specific search constraints...
      .filter((event) => filterPredicate(event)) // ...but only if they match the general filter window as well
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

    let cursor = search.anchorId;
    let inclusive = search.anchorInclusivity === "inclusive";
    while (true) {
      let anchorBound: BinaryOperator;
      if (upDirection) {
        anchorBound = inclusive ? lte : lt;
      } else {
        anchorBound = inclusive ? gte : gt;
      }
      const chunk = this.sqlite
        .select({ id: $containerEvent.id, line: $containerEvent.line })
        .from($containerEvent)
        .where(
          and(
            eq($containerEvent.containerId, container.id),
            // only logs matching the specific search constraints...
            cursor === undefined ? undefined : anchorBound($containerEvent.id, Uuid.toBytes(cursor)),
            search.logLinePattern.patternVariant === LogLinePattern.Variant.substr
              ? EventRepository.containing(search.logLinePattern.pattern)
              : undefined,
            // ...but only if they match the general filter window as well
            ...EventRepository.filterBound(filter),
            filter.logLinePattern?.patternVariant === LogLinePattern.Variant.substr
              ? EventRepository.containing(filter.logLinePattern.pattern)
              : undefined,
          ),
        )
        .orderBy(upDirection ? desc($containerEvent.id) : asc($containerEvent.id))
        .limit(CHUNK)
        .all();
      if (chunk.length === 0) {
        break;
      }

      for (const row of chunk) {
        const databaseCandidate: EventRepository.Candidate = { id: Uuid.fromBytes(row.id), line: row.line };
        if (searchPredicate(databaseCandidate) && filterPredicate(databaseCandidate)) {
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
      inclusive = false;
    }

    // no database match, so the buffer match is our best (and only) candidate ...
    return bufferMatch ?? null;
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
    const where = and(
      eq($containerEvent.containerId, container),
      bound,
      ...EventRepository.filterBound(filter),
      filter.logLinePattern?.patternVariant === "substr" ? EventRepository.containing(filter.logLinePattern.pattern) : undefined,
    );
    const matches = filter.logLinePattern?.patternVariant === "regex" ? LogLinePattern.predicate(filter.logLinePattern) : undefined;
    return this.readFiltered(where, false, 1, matches).length > 0;
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

export namespace EventRepository {
  /**
   * Where to read from. All are ids of events the caller already holds; none means the live end.
   * Which one is set also decides the direction read, not merely the bound.
   */
  export type Cursor = {
    /** Backwards, exclusive. */
    before?: string;
    /** Forwards, exclusive -- paging on from a line already read. */
    after?: string;
    /**
     * Forwards, keeping the line itself. Arriving at a *found* line differs from paging on from one
     * already read: the whole point is to be shown it, so it has to open the window rather than sit
     * just off the top of it.
     */
    afterInclusive?: string;
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

  export function filterBound(filter: Filter) {
    return [
      filter.since === undefined ? undefined : gte($containerEvent.id, Uuid.lowerBoundAt(filter.since)),
      filter.until === undefined ? undefined : lt($containerEvent.id, Uuid.lowerBoundAt(filter.until)),
    ];
  }

  /**
   * All either predicate needs, and all both halves can offer: a stored row is `{ id, line }` long
   * before it is an event. Asking for less is what lets one predicate judge the buffer and the
   * database, so the two can no longer drift apart.
   */
  export type Candidate = { id: string; line: string | null };

  /**
   * The span is compared as *ids*, exactly as {@link filterBound} hands it to sqlite -- a uuidv7 opens with
   * the millisecond, so the comparison the index performs and the one performed here are the same
   * one. Comparing timestamps instead would be a shade more precise on one side than the other, and
   * would cost an `Instant` parse per row on a scan that reads every row in the range.
   */
  export function filterPredicate(filter: Filter): (candidate: Candidate) => boolean {
    const patternPredicate = filter.logLinePattern ? LogLinePattern.predicate(filter.logLinePattern) : undefined;
    const since = filter.since === undefined ? undefined : Uuid.fromBytes(Uuid.lowerBoundAt(filter.since));
    const until = filter.until === undefined ? undefined : Uuid.fromBytes(Uuid.lowerBoundAt(filter.until));
    return ({ id, line }) =>
      (since === undefined || id >= since) &&
      (until === undefined || id < until) &&
      // a start or a stop has no text, so it cannot answer a pattern -- but it is inside a bare span
      (patternPredicate === undefined || (line !== null && patternPredicate(line)));
  }

  /**
   * The line to search out from, and whether it may itself be the answer
   */
  export type Search = {
    logLinePattern: LogLinePattern;
    anchorId?: string;
    anchorInclusivity?: "inclusive" | "exclusive";
    direction: "up" | "down";
  };

  /** The `like` prefilter for a literal needle, with sqlite's own wildcards defanged. */
  export function containing(needle: string) {
    const escaped = needle.replace(/[\\%_]/g, (character) => `\\${character}`);
    return sql`${$containerEvent.line} like ${`%${escaped}%`} escape '\\'`;
  }

  export function searchPredicate({ logLinePattern, anchorId, anchorInclusivity, direction }: Search): (candidate: Candidate) => boolean {
    const patternPredicate = LogLinePattern.predicate(logLinePattern);
    const beyondPredicate = ({ id }: Candidate): boolean => {
      if (anchorId === undefined) {
        return true;
      }
      if (id === anchorId) {
        return anchorInclusivity === "inclusive";
      }
      switch (direction) {
        case "up":
          return id < anchorId;
        case "down":
          return id > anchorId;
      }
    };
    return (candidate) => beyondPredicate(candidate) && candidate.line !== null && patternPredicate(candidate.line);
  }

  export type Page = {
    events: ContainerEvent[];
    hasOlder: boolean;
    hasNewer: boolean; // false means: it reaches the live feed
  };
}
