import { Logger } from "@/Logger";
import { ContainerEventConverter } from "@/drizzle/converters/ContainerEventConverter";
import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, desc, eq, inArray, lt, lte, notExists, sql } from "drizzle-orm";
import { BehaviorSubject, catchError, concatMap, defer, EMPTY, interval, Observable, retry } from "rxjs";

/**
 * Recent events are held in memory until they are flushed, and queries answer from both halves.
 */
export class ContainerEventRepository {
  private readonly log = new Logger(__filename);
  private readonly containers = new BehaviorSubject<Container[]>([]);
  private pending: ContainerEvent[] = [];
  private flushing = false;

  public constructor(private readonly sqlite: Sqlite) {}

  public initialize(): void {
    this.publishContainers();
    this.flushPeriodically();
  }

  public streamContainers(): Observable<Container[]> {
    return this.containers;
  }

  /**
   * To-be-persisted events are temporarily buffered before being batch-inserted
   */
  public save(event: ContainerEvent): void {
    this.pending.push(event);
    this.enforceCeiling();
  }

  private flushPeriodically(): void {
    const FLUSH_INTERVAL_MS = 1_000;
    const RETRY_DELAY_MS = 2_000;
    const RETRY_COUNT = 2;

    if (this.flushing) {
      return;
    }
    this.flushing = true;

    interval(FLUSH_INTERVAL_MS)
      .pipe(
        // `concatMap` keeps writes in order and stops them overlapping: the next flush waits for the
        // current one to land. `defer` matters here: without it `flush` would be called once up
        // front, and a retry would re-subscribe to a promise that had already settled
        concatMap(() =>
          defer(() => this.flush()).pipe(
            retry({ count: RETRY_COUNT, delay: RETRY_DELAY_MS }),
            // Failing is not allowed to error the stream. Left unhandled it would end this
            // subscription silently, and writing would simply stop. The events stay buffered, so
            // the next tick tries again with them still in hand
            catchError((error) => {
              this.log.error(`Could not flush after ${RETRY_COUNT} retries; the events stay buffered`, error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe({
        error: (error) => this.log.error("Stopped writing buffered events", error),
      });
  }

  public async flush(): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }
    const batch = this.pending;
    this.pending = [];
    try {
      await this.append(batch);
    } catch (error) {
      this.pending = batch.concat(this.pending);
      this.enforceCeiling();
      throw error;
    }
  }

  private enforceCeiling(): void {
    const PENDING_CEILING = 50_000;

    if (this.pending.length <= PENDING_CEILING) {
      return;
    }
    const discarded = this.pending.length - PENDING_CEILING;
    this.pending = this.pending.slice(discarded);
    this.log.error(`Discarded ${discarded} unwritten events; the buffer is full at ${PENDING_CEILING}`);
  }

  /**
   * One transaction for the whole batch: a statement each would be orders of magnitude slower, and
   * a half-written batch would leave events pointing at containers that were never recorded.
   *
   * Containers are upserted once per distinct container rather than once per event -- the caller
   * hands us a batch, and a busy container contributes hundreds of rows to it.
   */
  public async append(events: ContainerEvent[]): Promise<void> {
    const INSERT_CHUNK = 1_000;

    if (events.length === 0) {
      return;
    }
    this.sqlite.transaction((tx) => {
      const ids = new Map<string, number>();
      for (const { container, timestamp } of events) {
        if (ids.has(container.id)) {
          continue;
        }
        const seen = timestamp.toString();
        const [row] = tx
          .insert($container)
          .values({
            dockerId: container.id,
            name: container.name,
            groupName: container.group ?? null,
            firstSeen: seen,
            lastSeen: seen,
          })
          .onConflictDoUpdate({
            target: $container.dockerId,
            set: { name: container.name, groupName: container.group ?? null, lastSeen: seen },
          })
          .returning({ id: $container.id })
          .all();
        ids.set(container.id, row!.id);
      }
      /**
       * Split across statements, because SQLite caps how many values one statement may bind and a
       * single insert of the whole batch would blow past it. Still one transaction, so the batch
       * remains all-or-nothing.
       */
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
   * A page of history, newest first internally but handed back oldest-first so it can be rendered
   * straight into a log view.
   *
   * `before` walks further back for scrolling up, and is simply the id of the oldest event already
   * held. No cursor is handed out alongside the page: a caller reads it off whichever event it is
   * currently showing, so what it asks for cannot drift away from what it displays.
   *
   * Unwritten events are part of the answer, and not only for the newest page: a reader whose oldest
   * line is still buffered has everything just above it buffered too.
   */
  public async listEvents(dockerId: string, limit: number, before?: string): Promise<ContainerEventRepository.Page> {
    const container = this.sqlite.select().from($container).where(eq($container.dockerId, dockerId)).get();
    const stored = !container
      ? []
      : this.sqlite
          .select()
          .from($containerEvent)
          .where(
            before === undefined
              ? eq($containerEvent.container, container.id)
              : and(eq($containerEvent.container, container.id), lt($containerEvent.id, Uuid.toBytes(before))),
          )
          .orderBy(desc($containerEvent.id))
          .limit(limit)
          .all();

    // uuidv7s are time-ordered, so comparing them as text is comparing them by age
    const buffered = this.pending.filter((event) => event.container.id === dockerId && (before === undefined || event.id < before));
    const model = container ? ContainerEventConverter.containerFromDatabase(container) : undefined;
    const events = [...stored.map((row) => ContainerEventConverter.fromDatabase(row, model!)), ...buffered];

    /**
     * A flush landing between the two reads puts the same event in both halves, so they are merged
     * by id rather than concatenated. Sorted rather than assumed ordered for the same reason.
     */
    const merged = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
      // either the query filled its page, or the merge produced more than was asked for
      hasOlder: stored.length === limit || merged.length > limit,
      events: merged.slice(-limit),
    };
  }

  /** The overview page's ordering data: who exists, and when each last said anything. */
  public async listOverview(): Promise<{ container: Container; lastSeen: Temporal.Instant }[]> {
    const rows = this.sqlite.select().from($container).orderBy(desc($container.lastSeen)).all();
    return rows.map((row) => ({
      container: ContainerEventConverter.containerFromDatabase(row),
      lastSeen: Temporal.Instant.from(row.lastSeen),
    }));
  }

  /**
   * Caps how much history any one container may hold, so a chatty neighbour cannot evict everyone
   * else's. A global size cap alone has exactly that failure: a container at the throttle ceiling
   * produces events all day and would come to occupy the entire budget, leaving a quiet service
   * with no history at all on the day it finally breaks.
   *
   * Counted in events rather than bytes, because both the count and the delete then ride the
   * `(container, id)` index -- and "keep the last N lines" is a sentence an operator can hold in
   * their head, where "keep 20MB" is not.
   */
  public async pruneToEventsPerContainer(maxEvents: number): Promise<{ events: number }> {
    const containers = this.sqlite.select({ id: $container.id }).from($container).all();
    let events = 0;
    for (const { id } of containers) {
      // the newest event beyond the ones we are keeping; everything at or below it is surplus
      const [surplus] = this.sqlite
        .select({ id: $containerEvent.id })
        .from($containerEvent)
        .where(eq($containerEvent.container, id))
        .orderBy(desc($containerEvent.id))
        .limit(1)
        .offset(maxEvents)
        .all();
      if (!surplus) {
        continue;
      }
      const deleted = this.sqlite
        .delete($containerEvent)
        .where(and(eq($containerEvent.container, id), lte($containerEvent.id, surplus.id)))
        .returning({ id: $containerEvent.id })
        .all();
      events += deleted.length;
    }
    return { events };
  }

  /**
   * Deletes the oldest events until the database fits the given budget, then drops any container
   * left without events. The caller decides how much room retention gets; getting under it -- the
   * chunking, the page accounting, the orphan sweep -- is this layer's business.
   *
   * It stops a little below the budget rather than exactly at it, so the very next batch of writes
   * does not immediately put it over again.
   */
  public async pruneToSize(maxBytes: number): Promise<{ events: number; containers: number }> {
    const TARGET_RATIO = 0.9;
    const CHUNK = 10_000;

    if (this.usedBytes() <= maxBytes) {
      return { events: 0, containers: 0 };
    }
    const target = maxBytes * TARGET_RATIO;
    let events = 0;
    // chunked, because one enormous delete holds the write lock long enough to stall appends
    while (this.usedBytes() > target) {
      const deleted = this.deleteOldestEvents(CHUNK);
      if (deleted === 0) {
        break;
      }
      events += deleted;
    }
    return { events, containers: this.deleteContainersWithoutEvents() };
  }

  /**
   * Pages actually in use, rather than the file size -- SQLite never returns space to the
   * filesystem, so the file only ever grows and would make pruning look like it achieved nothing.
   * Deleted pages land on the freelist and are reused, so subtracting them is what moves.
   */
  private usedBytes(): number {
    const [pages] = this.sqlite.all<{ page_count: number }>(sql`pragma page_count`);
    const [freed] = this.sqlite.all<{ freelist_count: number }>(sql`pragma freelist_count`);
    const [size] = this.sqlite.all<{ page_size: number }>(sql`pragma page_size`);
    return ((pages?.page_count ?? 0) - (freed?.freelist_count ?? 0)) * (size?.page_size ?? 0);
  }

  /**
   * Deletes the oldest events. `id` is the rowid and monotonic, so "oldest" is a walk from the
   * start of the clustered key with no sort involved.
   */
  private deleteOldestEvents(count: number): number {
    const doomed = this.sqlite.select({ id: $containerEvent.id }).from($containerEvent).orderBy(asc($containerEvent.id)).limit(count).all();
    if (doomed.length === 0) {
      return 0;
    }
    this.sqlite
      .delete($containerEvent)
      .where(
        inArray(
          $containerEvent.id,
          doomed.map(({ id }) => id),
        ),
      )
      .run();
    return doomed.length;
  }

  /**
   * Containers whose last event has been pruned away. `notExists` seeks the events index per
   * container rather than scanning it, unlike the `distinct` a view would have needed.
   */
  private deleteContainersWithoutEvents(): number {
    const deleted = this.sqlite
      .delete($container)
      .where(
        notExists(
          this.sqlite
            .select({ one: sql`1` })
            .from($containerEvent)
            .where(eq($containerEvent.container, $container.id)),
        ),
      )
      .returning({ id: $container.id })
      .all();
    // pruning may have forgotten a container entirely
    this.publishContainers();
    return deleted.length;
  }

  /**
   * Called after every mutation, but only emits when the set genuinely differs. Appends happen once
   * a second and almost always touch containers that are already known: the row's `lastSeen` moves,
   * yet nothing a {@link Container} carries does, and re-emitting an identical list would have every
   * subscriber redraw for nothing.
   *
   * Must run after a transaction commits, never inside it, so state that could still roll back is
   * never published.
   */
  private publishContainers(): void {
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
}

export namespace ContainerEventRepository {
  export type Page = {
    events: ContainerEvent[];
    /** Whether anything remains above; the page above is asked for with the oldest event's id. */
    hasOlder: boolean;
  };
}
