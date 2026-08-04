import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEventConverter } from "@/drizzle/converters/ContainerEventConverter";
import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, desc, eq, gt, lt, lte, notExists, sql } from "drizzle-orm";
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

  public async listEvents(dockerId: string, limit: number, cursor: EventRepository.Cursor = {}): Promise<EventRepository.Page> {
    const { before, after } = cursor;
    const forwards = after !== undefined;
    const container = this.sqlite.select().from($container).where(eq($container.dockerId, dockerId)).get();
    const bounds = [
      container ? eq($containerEvent.container, container.id) : undefined,
      before === undefined ? undefined : lt($containerEvent.id, Uuid.toBytes(before)),
      after === undefined ? undefined : gt($containerEvent.id, Uuid.toBytes(after)),
    ];
    const stored = !container
      ? []
      : this.sqlite
          .select()
          .from($containerEvent)
          .where(and(...bounds))
          // reading forwards takes the oldest beyond the cursor; otherwise the newest before it
          .orderBy(forwards ? asc($containerEvent.id) : desc($containerEvent.id))
          .limit(limit)
          .all();

    // uuidv7s are time-ordered, so comparing them as text is comparing them by age
    const buffered = this.pending.filter(
      (event) =>
        event.container.id === dockerId && (before === undefined || event.id < before) && (after === undefined || event.id > after),
    );
    const model = container ? ContainerEventConverter.containerFromDatabase(container) : undefined;
    const events = [...stored.map((row) => ContainerEventConverter.fromDatabase(row, model!)), ...buffered];

    // A flush landing between the two reads puts the same event in both halves, so they are merged
    // by id rather than concatenated. Sorted rather than assumed ordered for the same reason.
    const merged = [...new Map(events.map((event) => [event.id, event])).values()].sort((a, b) => a.id.localeCompare(b.id));
    // the query filled its page, or the merge produced more than was asked for, so that edge has more
    const saturated = stored.length === limit || merged.length > limit;
    return {
      events: forwards ? merged.slice(0, limit) : merged.slice(-limit),
      // whatever lies past the cursor is unexamined, so that side is assumed to have more
      hasOlder: forwards ? true : saturated,
      hasNewer: forwards ? saturated : before !== undefined,
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
        .where(eq($containerEvent.container, id))
        .orderBy(desc($containerEvent.id))
        .limit(1)
        .offset(maxEvents)
        .all();
      if (surplusCursor) {
        const deleted = this.sqlite
          .delete($containerEvent)
          .where(and(eq($containerEvent.container, id), lte($containerEvent.id, surplusCursor.id)))
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
            .where(eq($containerEvent.container, $container.id)),
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
  /** Where to read from. Both are ids of events the caller already holds; neither means the live end. */
  export type Cursor = {
    before?: string;
    after?: string;
  };

  export type Page = {
    events: ContainerEvent[];
    /** Whether the window can be extended at each end; `hasNewer` false means it reaches the live feed. */
    hasOlder: boolean;
    hasNewer: boolean;
  };
}
