import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEventConverter } from "@/drizzle/converters/ContainerEventConverter";
import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Filter } from "@/models/Filter";
import { Pattern } from "@/models/Pattern";
import { Svc } from "@/models/Svc";
import { Uuid } from "@/models/Uuid";
import { Temporal } from "@js-temporal/polyfill";
import { and, asc, desc, eq, gt, inArray, InferInsertModel, isNull, lt, lte, notExists, SQL, sql } from "drizzle-orm";
import { BehaviorSubject, catchError, concatMap, defer, EMPTY, interval, Observable } from "rxjs";
import { PredicateFactory } from "./PredicateFactory";

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

  /**
   * Also manually invoked after every write, so the overview reflects containers that have only just (dis)appeared
   */
  @Initialize
  private publishUpdatedContainers(): void {
    const containers = this.sqlite
      .select()
      .from($container)
      .orderBy(asc($container.dname), asc($container.did))
      .all()
      .map(ContainerEventConverter.containerFromDatabase);
    const previous = this.containers.value;
    const unchanged =
      previous.length === containers.length &&
      previous.every((was, index) => {
        const now = containers[index]!;
        return was.did === now.did && was.dname === now.dname && was.dgroup === now.dgroup && was.online === now.online;
      });
    if (!unchanged) {
      this.containers.next(containers);
    }
  }

  private listContainersForService(svcId: Svc.Id) {
    return this.sqlite
      .select()
      .from($container)
      .where(and(eq($container.dname, svcId.dname), svcId.dgroup ? eq($container.dgroup, svcId.dgroup) : isNull($container.dgroup)))
      .all();
  }

  public saveEvent(event: ContainerEvent): void {
    this.pending.push(event);
    this.enforcePendingCeiling();
  }

  public async findEvent(svcId: Svc.Id, search: EventRepository.Search, filter: Filter): Promise<{ id: string | undefined }> {
    const searchPredicate = {
      fullObjectTest: PredicateFactory.forSearch("full_object_test", search),
      partialDatabaseTest: PredicateFactory.forSearch("partial_database_test", search),
    };
    const filterPredicate = {
      fullObjectTest: PredicateFactory.forFilter("full_object_test", filter),
      partialDatabaseTest: PredicateFactory.forFilter("partial_database_test", filter),
    };

    //
    // Part A: search the buffer for a candidate
    //
    const bufferMatchesBeyondSearchAnchor = this.pending
      .filter((event): event is ContainerEvent.Log => event.type === ContainerEvent.Type.log && Svc.matches(svcId, event.container))
      .filter((event) => searchPredicate.fullObjectTest(event)) // only logs matching the specific search constraints...
      .filter((event) => filterPredicate.fullObjectTest(event)) // ...but only if they match the general filter window as well
      .sort(ContainerEvent.sort(search.direction)); // sorted the way the search runs, so the nearest match is simply the first
    const bufferMatch = bufferMatchesBeyondSearchAnchor.at(0)?.id;

    //
    // Part B: search the database for a candidate
    //
    const CHUNK = 1_000;
    const containers = this.listContainersForService(svcId);
    if (containers.length === 0) {
      return { id: bufferMatch }; // nothing was ever flushed, so the buffer contains all history
    }

    // the anchor opens the walk; every chunk after it resumes from the last row already read
    let cursor = search.anchorId;
    while (true) {
      const chunk = this.sqlite
        .select({ id: $containerEvent.id, line: $containerEvent.line })
        .from($containerEvent)
        .where(
          and(
            inArray(
              $containerEvent.containerId,
              containers.map((c) => c.id),
            ),
            ...searchPredicate.partialDatabaseTest(cursor), // only logs matching the specific search constraints...
            ...filterPredicate.partialDatabaseTest(), // ...but only if they match the general filter window as well
          ),
        )
        .orderBy(search.direction === Direction.forwards_in_time ? asc($containerEvent.id) : desc($containerEvent.id))
        .limit(CHUNK)
        .all();
      if (chunk.length === 0) {
        break;
      }

      for (const row of chunk) {
        const databaseCandidate: PredicateFactory.Candidate = {
          id: Uuid.fromBytes(row.id),
          line: row.line ?? undefined,
        };
        if (searchPredicate.fullObjectTest(databaseCandidate) && filterPredicate.fullObjectTest(databaseCandidate)) {
          const databaseMatch = databaseCandidate.id;

          //
          // Part C: compare both matches
          //
          if (!bufferMatch) {
            return { id: databaseMatch };
          }
          switch (search.direction) {
            case Direction.forwards_in_time:
              return {
                id: bufferMatch < databaseMatch ? bufferMatch : databaseMatch,
              };
            case Direction.backwards_in_time:
              return {
                id: bufferMatch > databaseMatch ? bufferMatch : databaseMatch,
              };
          }
        }
      }
      cursor = Uuid.fromBytes(chunk.at(-1)!.id);
    }

    // no database match, so the buffer match is our best (and only) candidate ...
    return { id: bufferMatch };
  }

  public async listEvents(
    svcId: Svc.Id,
    limit: number,
    cursor: EventRepository.Cursor,
    filter: Filter,
  ): Promise<EventRepository.ListResult> {
    // If we didn't get any cursor, we default to showing the latest logs, and walking backwards_in_time
    const direction = cursor.after !== undefined ? Direction.forwards_in_time : Direction.backwards_in_time;

    const cursorPredicate = {
      fullObjectTest: PredicateFactory.forCursor("full_object_test", cursor),
      fullDatabaseTest: PredicateFactory.forCursor("full_database_test", cursor),
    };
    const filterPredicate = {
      fullObjectTest: PredicateFactory.forFilter("full_object_test", filter),
      partialDatabaseTest: PredicateFactory.forFilter("partial_database_test", filter),
    };

    let dbEvents: ContainerEvent[] = [];
    const dbContainers = this.listContainersForService(svcId);

    //
    // Part A: list the database
    //
    dbEvents = this.queryEventsUpToLimitWithPredicate({
      limit: limit + 1, // +1 for `hasNewer/hasOlder`
      direction,
      where: and(
        inArray(
          $containerEvent.containerId,
          dbContainers.map((c) => c.id),
        ),
        ...cursorPredicate.fullDatabaseTest(), // only logs matching the specific cursor constraints...
        ...filterPredicate.partialDatabaseTest(), // ...but only if they match the general filter window as well
      ),
      predicate: filterPredicate.fullObjectTest,
      mapper: (row) => ContainerEventConverter.eventFromDatabase(row, dbContainers),
    });
    //
    // Part B: list the buffer
    //
    const bufferEvents = this.pending
      .filter((event): event is ContainerEvent.Log => event.type === ContainerEvent.Type.log && Svc.matches(svcId, event.container))
      .filter((event) => cursorPredicate.fullObjectTest(event)) // only logs matching the specific cursor constraints...
      .filter((event) => filterPredicate.fullObjectTest(event)); // ...but only if they match the general filter window as well
    //
    // Part C: combine both lists, deduplicate events by ID, and (always) sort from old to new
    //
    const events = [...new Map([...dbEvents, ...bufferEvents].map((event) => [event.id, event])).values()] //
      .sort(ContainerEvent.sort(Direction.forwards_in_time));

    switch (direction) {
      case Direction.forwards_in_time: {
        const page = events.slice(0, limit);
        const hasNewer = events.length > limit;
        return {
          data: page,
          hasNewer,
          hasOlder: this.hasAnythingOlderThan(
            dbContainers.map((c) => c.id),
            page.at(0)?.id,
            cursor.after,
            filter,
          ),
        };
      }
      case Direction.backwards_in_time: {
        // quick reminder that `cursor.before` is always "exclusive"
        if (cursor.beforeInclusivity && cursor.beforeInclusivity !== "exclusive") {
          cursor.beforeInclusivity satisfies never;
        }
        const hasNewer = cursor.before !== undefined;
        return {
          data: events.slice(-limit),
          hasOlder: events.length > limit,
          hasNewer,
        };
      }
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
      const distinctContainers = new Map<string, Container>();
      for (const { container } of events) {
        distinctContainers.set(container.did, container);
      }

      const containerIds = new Map<string, number>(); // `did` -> `id`
      const containerRows = [...distinctContainers.values()].map<InferInsertModel<typeof $container>>((container) => ({
        did: container.did,
        dname: container.dname,
        dgroup: container.dgroup ?? null,
        online: container.online,
      }));
      for (let offset = 0; offset < containerRows.length; offset += INSERT_CHUNK) {
        tx.insert($container)
          .values(containerRows.slice(offset, offset + INSERT_CHUNK))
          // `excluded` is the row we tried to insert, so one statement carries a different name and
          // timestamp for every container. `firstSeen` is left alone: it is only true of the insert
          .onConflictDoUpdate({
            target: $container.did,
            set: {
              dname: sql`excluded.${$container.dname.name}`,
              dgroup: sql`excluded.${$container.dgroup.name}`,
              online: sql`excluded.${$container.online.name}`,
            },
          })
          // returned in no guaranteed order, so the docker id comes back too rather than being positional
          .returning({ id: $container.id, did: $container.did })
          .all()
          .forEach((row) => containerIds.set(row.did, row.id));
      }

      // Split across statements, because SQLite caps how many values one statement may bind and a
      // single insert of the whole batch would blow past it. Still one transaction, so the batch
      // remains all-or-nothing.
      const rows = events.map((event) => {
        const containerId = containerIds.get(event.container.did)!;
        return ContainerEventConverter.toDatabase(event, containerId);
      });
      for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
        tx.insert($containerEvent)
          .values(rows.slice(offset, offset + INSERT_CHUNK))
          .run();
      }
    });
    // a write may have introduced a container, or renamed one
    this.publishUpdatedContainers();
  }

  private queryEventsUpToLimitWithPredicate<T = typeof $containerEvent.$inferSelect>({
    where,
    direction,
    limit,
    predicate,
    mapper = (x) => x as T,
  }: {
    where: ReturnType<typeof and>;
    direction: Direction;
    limit: number;
    predicate?: (candidate: PredicateFactory.Candidate) => boolean;
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
        if (collected.length < limit) {
          if (predicate({ id: Uuid.fromBytes(row.id), line: row.line ?? undefined })) {
            collected.push(row);
          }
        }
      }
      cursor = chunk.at(-1)!.id as Buffer;
    }
    return collected.map(mapper);
  }

  private hasAnythingOlderThan(
    containerIds: number[],
    oldestShownEventId: string | undefined,
    cursor: string | undefined,
    filter: Filter,
  ): boolean {
    let sqlClause: SQL<unknown> | undefined;
    if (oldestShownEventId !== undefined) {
      sqlClause = lt($containerEvent.id, Uuid.toBytes(oldestShownEventId));
    } else if (cursor !== undefined) {
      sqlClause = lte($containerEvent.id, Uuid.toBytes(cursor));
    }

    // nothing is written for these containers yet, so nothing can be older than the page
    if (containerIds.length === 0 || !sqlClause) {
      return false;
    }

    const filterPredicate = {
      fullObjectTest: PredicateFactory.forFilter("full_object_test", filter),
      partialDatabaseTest: PredicateFactory.forFilter("partial_database_test", filter),
    };
    return (
      this.queryEventsUpToLimitWithPredicate({
        limit: 1,
        direction: Direction.backwards_in_time,
        where: and(inArray($containerEvent.containerId, containerIds), sqlClause, ...filterPredicate.partialDatabaseTest()),
        predicate: filterPredicate.fullObjectTest,
      }).length > 0
    );
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
    this.publishUpdatedContainers();
    return deleted;
  }
}

export namespace EventRepository {
  export type Search = {
    pattern: Pattern;
    anchorId?: string;
    anchorInclusivity?: "inclusive" | "exclusive";
    direction: Direction;
  };

  export type Cursor = {
    before?: string;
    beforeInclusivity?: "exclusive"; // only allowed variant
    after?: string;
    afterInclusivity?: "inclusive" | "exclusive";
  };

  export type ListResult = {
    data: ContainerEvent[];
    hasOlder: boolean;
    hasNewer: boolean;
  };
}
