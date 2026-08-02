import { ContainerEventConverter } from "@/drizzle/converters/ContainerEventConverter";
import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { asc, eq, inArray, notExists, sql } from "drizzle-orm";
import { BehaviorSubject, Observable } from "rxjs";

/** Rows per insert statement, kept well inside SQLite's cap on bound values per statement. */
const INSERT_CHUNK = 1_000;

export class ContainerEventRepository {
  private readonly containers = new BehaviorSubject<Container[]>([]);

  public constructor(private readonly sqlite: Sqlite) {}

  public initialize(): void {
    this.publishContainers();
  }

  public streamContainers(): Observable<Container[]> {
    return this.containers;
  }

  /**
   * One transaction for the whole batch: a statement each would be orders of magnitude slower, and
   * a half-written batch would leave events pointing at containers that were never recorded.
   *
   * Containers are upserted once per distinct container rather than once per event -- the caller
   * hands us a batch, and a busy container contributes hundreds of rows to it.
   */
  public async append(events: ContainerEvent[]): Promise<void> {
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
    this.initialize();
  }

  public async findEvents(dockerId: string, limit: number): Promise<ContainerEvent[]> {
    const container = await this.sqlite.query.$container.findFirst({ where: eq($container.dockerId, dockerId) });
    if (!container) {
      return [];
    }
    const rows = await this.sqlite.query.$containerEvent.findMany({
      where: eq($containerEvent.container, container.id),
      orderBy: asc($containerEvent.id),
      limit,
    });
    const model = ContainerEventConverter.containerFromDatabase(container);
    return rows.map((row) => ContainerEventConverter.fromDatabase(row, model));
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
    this.initialize();
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
