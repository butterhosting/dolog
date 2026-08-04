import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEventConverter } from "@/drizzle/converters/ContainerEventConverter";
import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, desc, eq, inArray, lt, lte, notExists, sql } from "drizzle-orm";
import { BehaviorSubject, catchError, concatMap, defer, EMPTY, interval, Observable } from "rxjs";

/**
 * Recent events are held in memory until they are flushed, and queries answer from both halves.
 */
export class LogRepository {
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
    this.enforceCeilingToBuffer();
  }

  public async listEvents(dockerId: string, limit: number, before?: string): Promise<LogRepository.Page> {
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

    // A flush landing between the two reads puts the same event in both halves, so they are merged
    // by id rather than concatenated. Sorted rather than assumed ordered for the same reason.
    const merged = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
      // either the query filled its page, or the merge produced more than was asked for
      hasOlder: stored.length === limit || merged.length > limit,
      events: merged.slice(-limit),
    };
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
        this.enforceCeilingToBuffer();
      } else {
        this.failedFlushes = 0;
        this.log.error(`Gave up on ${batch.length} events after ${GIVE_UP_AFTER_FLUSHES} failed flushes; discarding them`, error);
      }
      throw error;
    }
  }

  private enforceCeilingToBuffer(): void {
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
   * Forgets everything older than the cutoff, then drops any container left without events.
   *
   * Age is read off the id rather than the timestamp column: a uuidv7 opens with the millisecond it
   * was minted, so "older than" is a range on the primary key, and the rows being deleted are one
   * contiguous run at the start of it. That is the shape that actually hands pages back -- deleting
   * a scattered subset frees almost nothing, because a page only goes onto the freelist once every
   * row on it is gone.
   */
  public async pruneOlderThan(cutoff: Temporal.Instant): Promise<{ events: number; containers: number }> {
    const CHUNK = 10_000;

    const boundary = Uuid.lowerBoundAt(cutoff);
    let events = 0;
    // chunked, because one enormous delete holds the write lock long enough to stall appends
    for (;;) {
      const doomed = this.sqlite
        .select({ id: $containerEvent.id })
        .from($containerEvent)
        .where(lt($containerEvent.id, boundary))
        .orderBy(asc($containerEvent.id))
        .limit(CHUNK)
        .all();
      if (doomed.length === 0) {
        break;
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
      events += doomed.length;
    }
    return { events, containers: this.deleteContainersWithoutEvents() };
  }

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
}

export namespace LogRepository {
  export type Page = {
    events: ContainerEvent[];
    hasOlder: boolean;
  };
}
