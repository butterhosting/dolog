import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEventConverter } from "@/drizzle/converters/ContainerEventConverter";
import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { LineMatch } from "@/helpers/LineMatch";
import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, desc, eq, gt, gte, lt, lte, notExists, sql } from "drizzle-orm";
import { BehaviorSubject, catchError, concatMap, defer, EMPTY, interval, Observable } from "rxjs";

/**
 * Recent events are held in memory until they are flushed
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

  public async listContainers(): Promise<{ container: Container; lastSeen: Temporal.Instant }[]> {
    const rows = this.sqlite.select().from($container).orderBy(desc($container.lastSeen)).all();
    return rows.map((row) => ({
      container: ContainerEventConverter.containerFromDatabase(row),
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
    cursor: EventRepository.Cursor = {},
    filter: EventRepository.Filter = {},
  ): Promise<EventRepository.Page> {
    const { before, after, from } = cursor;
    const forwards = after !== undefined || from !== undefined;
    const container = this.sqlite.select().from($container).where(eq($container.dockerId, dockerId)).get();
    const bounds = [
      container ? eq($containerEvent.containerId, container.id) : undefined,
      before === undefined ? undefined : lt($containerEvent.id, Uuid.toBytes(before)),
      after === undefined ? undefined : gt($containerEvent.id, Uuid.toBytes(after)),
      from === undefined ? undefined : gte($containerEvent.id, Uuid.toBytes(from)),
      ...EventRepository.span(filter),
      // a substring narrows the query itself; a regular expression cannot, and is tested below
      filter.matcher?.variant === "substr" ? EventRepository.containing(filter.matcher.pattern) : undefined,
    ];
    const matches = filter.matcher ? LineMatch.predicate(filter.matcher.pattern, filter.matcher.variant) : undefined;
    const stored = !container
      ? []
      : this.readFiltered(and(...bounds), forwards, limit, filter.matcher?.variant === "regex" ? matches : undefined);

    // uuidv7s are time-ordered, so comparing them as text is comparing them by age
    const buffered = this.pending.filter(
      (event) =>
        event.container.id === dockerId &&
        (before === undefined || event.id < before) &&
        (after === undefined || event.id > after) &&
        (from === undefined || event.id >= from) &&
        EventRepository.within(event, filter) &&
        (matches === undefined || (event.type === ContainerEvent.Type.log && matches(event.line))),
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
      hasOlder: forwards ? this.anythingOlderThan(container?.id, page.at(0)?.id, after ?? from, filter) : saturated,
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
      this.sqlite
        .select()
        .from($containerEvent)
        .where(and(where, extra))
        .orderBy(order)
        .limit(take)
        .all();

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
   *
   * Only a position is returned. The caller already knows how to fetch a window around an id, and
   * most answers are lines it is already showing -- so handing back a page here would throw away
   * work in the common case rather than saving any.
   *
   * The walk is bounded by where the match is, not by the size of the table: the index is
   * `(container, id)` and ids are time-ordered, so this reads along the key from the cursor and
   * stops at the first hit. Retention caps a container at
   * `X_DOLOG_RETENTION_MAX_LINES_PER_CONTAINER`, which is what makes even a fruitless search -- the
   * one case that reads everything -- affordable enough to need no budget of its own.
   */
  public async findEvent(
    dockerId: string,
    search: EventRepository.Search,
    filter: EventRepository.Filter = {},
  ): Promise<string | null> {
    const CHUNK = 1_000;
    const { needle, variant, from, inclusive, direction } = search;
    const up = direction === "up";
    const matches = LineMatch.predicate(needle, variant);
    // a filtered view is the corpus, so a line the filter excludes is not there to be found
    const inView = filter.matcher ? LineMatch.predicate(filter.matcher.pattern, filter.matcher.variant) : undefined;
    const container = this.sqlite.select().from($container).where(eq($container.dockerId, dockerId)).get();

    /**
     * Unflushed lines are searched too, or the newest part of the log -- the part most likely to be
     * looked at -- would be invisible to search alone among everything else the repository serves.
     */
    const buffered = this.pending
      // only ordinary log lines carry text; a start or a stop has nothing to search
      .filter((event) => event.container.id === dockerId && event.type === ContainerEvent.Type.log && matches(event.line))
      .filter((event) => EventRepository.within(event, filter) && (inView === undefined || inView((event as { line: string }).line)))
      .filter((event) => EventRepository.beyond(event.id, from, inclusive, up))
      .map((event) => event.id)
      .sort();
    const bufferedMatch = up ? buffered.at(-1) : buffered.at(0);

    let cursor = from;
    let first = true;
    while (container) {
      // only the opening chunk may include the anchor itself; after that the cursor is a line already read
      const bound = inclusive && first ? (up ? lte : gte) : up ? lt : gt;
      const chunk = this.sqlite
        .select({ id: $containerEvent.id, line: $containerEvent.line })
        .from($containerEvent)
        .where(
          and(
            eq($containerEvent.containerId, container.id),
            cursor === undefined ? undefined : bound($containerEvent.id, Uuid.toBytes(cursor)),
            // a substring is filtered by sqlite so non-matching rows never cross into javascript;
            // a regular expression cannot be pushed down, so those rows are tested here instead
            variant === "substr" ? EventRepository.containing(needle) : undefined,
            ...EventRepository.span(filter),
            filter.matcher?.variant === "substr" ? EventRepository.containing(filter.matcher.pattern) : undefined,
          ),
        )
        .orderBy(up ? desc($containerEvent.id) : asc($containerEvent.id))
        .limit(CHUNK)
        .all();
      first = false;
      if (chunk.length === 0) {
        break;
      }
      const hit = chunk.find((row) => row.line !== null && matches(row.line) && (inView === undefined || inView(row.line)));
      if (hit) {
        return EventRepository.nearest(Uuid.fromBytes(hit.id), bufferedMatch, up);
      }
      cursor = Uuid.fromBytes(chunk.at(-1)!.id);
    }
    return bufferedMatch ?? null;
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
      ...EventRepository.span(filter),
      filter.matcher?.variant === "substr" ? EventRepository.containing(filter.matcher.pattern) : undefined,
    );
    const matches =
      filter.matcher?.variant === "regex" ? LineMatch.predicate(filter.matcher.pattern, filter.matcher.variant) : undefined;
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
  /** Where to read from. All are ids of events the caller already holds; none means the live end. */
  export type Cursor = {
    before?: string;
    after?: string;
    /**
     * Like `after`, but keeping the line itself. Arriving at a *found* line differs from paging on
     * from one already read: the whole point is to be shown the line, so it has to open the window
     * rather than sit just off the top of it.
     */
    from?: string;
  };

  /** A pattern and how to read it. Search and filter each carry one, independently. */
  export type Matcher = { pattern: string; variant: LineMatch.Variant };

  /**
   * The narrowed view everything else operates inside. Absent parts narrow nothing, so `{}` is the
   * whole log.
   *
   * The span is expressed as *ids* rather than timestamps once it reaches sqlite: uuidv7s are
   * time-ordered, so a time range is a key range, and the walk is bounded by the index instead of
   * being filtered after the fact.
   */
  export type Filter = {
    matcher?: Matcher;
    since?: Temporal.Instant;
    until?: Temporal.Instant;
  };

  export function span(filter: Filter) {
    return [
      filter.since === undefined ? undefined : gte($containerEvent.id, Uuid.lowerBoundAt(filter.since)),
      filter.until === undefined ? undefined : lt($containerEvent.id, Uuid.lowerBoundAt(filter.until)),
    ];
  }

  /** The same span, for events still in the buffer and so never seen by a query. */
  export function within(event: ContainerEvent, filter: Filter): boolean {
    return (
      (filter.since === undefined || Temporal.Instant.compare(event.timestamp, filter.since) >= 0) &&
      (filter.until === undefined || Temporal.Instant.compare(event.timestamp, filter.until) < 0)
    );
  }

  export type Search = {
    needle: string;
    /** How to read `needle`. */
    variant: LineMatch.Variant;
    /** The line to search out from; absent starts at whichever end `direction` reads from. */
    from?: string;
    /**
     * Whether `from` may itself be the answer. False when stepping off a match already found -- it
     * would otherwise return that same line forever -- and true when the caller anchored on an
     * ordinary line it happened to be looking at, which has every right to match.
     */
    inclusive: boolean;
    direction: "up" | "down";
  };

  /** The `like` prefilter for a literal needle, with sqlite's own wildcards defanged. */
  export function containing(needle: string) {
    const escaped = needle.replace(/[\\%_]/g, (character) => `\\${character}`);
    return sql`${$containerEvent.line} like ${`%${escaped}%`} escape '\\'`;
  }

  /** Whether `id` lies on the far side of the anchor, in the direction being read. */
  export function beyond(id: string, from: string | undefined, inclusive: boolean, up: boolean): boolean {
    if (from === undefined) {
      return true;
    }
    if (id === from) {
      return inclusive;
    }
    return up ? id < from : id > from;
  }

  /** Of two matches found in the same direction, the one encountered first. */
  export function nearest(stored: string, bufferedMatch: string | undefined, up: boolean): string {
    if (bufferedMatch === undefined) {
      return stored;
    }
    return up ? (bufferedMatch > stored ? bufferedMatch : stored) : bufferedMatch < stored ? bufferedMatch : stored;
  }

  export type Page = {
    events: ContainerEvent[];
    /** Whether the window can be extended at each end; `hasNewer` false means it reaches the live feed. */
    hasOlder: boolean;
    hasNewer: boolean;
  };
}
