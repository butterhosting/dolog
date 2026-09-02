import { $container, $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { Env } from "@/Env";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { StreamVariant } from "@/models/StreamVariant";
import { Uuid } from "@/models/Uuid";
import { Temporal } from "@js-temporal/polyfill";
import { asc, eq, inArray, InferInsertModel, sql } from "drizzle-orm";

export class RestrictedService {
  private readonly log = new Logger(__filename);

  private readonly DNAME = "fixture";
  private readonly DID = "9348572893540278572759485339";
  private readonly DEPTH = Temporal.Duration.from({ days: 3 });
  private readonly SPACING = Temporal.Duration.from({ minutes: 10 }).total("milliseconds");

  public constructor(
    private readonly env: Env.Private,
    private readonly sqlite: Sqlite,
  ) {}

  @Initialize
  public async inventFixtureContainer(): Promise<void> {
    if (this.env.O_DOLOG_STAGE !== "dev") {
      return;
    }

    try {
      const containerId = this.upsertFixtureContainer();
      const cutoff = Temporal.Now.instant().subtract({ milliseconds: this.DEPTH.total("milliseconds") });
      const deleted = this.deleteHistory(this.findContainerIds());
      const invented = this.backfillHistory(containerId, cutoff);
      this.log.info(`Deleted ${deleted} and invented ${invented} ${this.DNAME} events; history reaches back to ${cutoff}`);
    } catch (error) {
      this.log.error("Could not invent history", error);
    }
  }

  private upsertFixtureContainer(): number {
    return this.sqlite
      .insert($container)
      .values({ did: this.DID, dname: this.DNAME, online: false })
      .onConflictDoUpdate({ target: $container.did, set: { dname: this.DNAME, online: false } })
      .returning({ id: $container.id })
      .all()
      .at(0)!.id;
  }

  /**
   * The wipe still goes by name rather than by our one row, so a stray same-name row cannot keep
   * stale events around
   */
  private findContainerIds(): number[] {
    return this.sqlite
      .select({ id: $container.id })
      .from($container)
      .where(eq($container.dname, this.DNAME))
      .orderBy(asc($container.id))
      .all()
      .map(({ id }) => id);
  }

  private deleteHistory(containerIds: number[]): number {
    // a row back per row deleted, since drizzle's driver types away SQLite's rows-affected count
    return this.sqlite
      .delete($containerEvent)
      .where(inArray($containerEvent.containerId, containerIds))
      .returning({ one: sql<number>`1` })
      .all().length;
  }

  private backfillHistory(containerId: number, cutoff: Temporal.Instant): number {
    const INSERT_CHUNK = 1_000;

    const nowMs = Temporal.Now.instant().epochMilliseconds;
    // whole spacing steps, so every line is a pure function of its slot and a reseeded run reads the same
    const rows: Array<InferInsertModel<typeof $containerEvent>> = [];
    for (let ms = nowMs - (nowMs % this.SPACING); ms >= cutoff.epochMilliseconds; ms -= this.SPACING) {
      const row = this.fakeEvent(ms, containerId);
      if (row) {
        rows.push(row);
      }
    }
    if (rows.length > 0) {
      this.sqlite.transaction((tx) => {
        for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK) {
          tx.insert($containerEvent)
            .values(rows.slice(offset, offset + INSERT_CHUNK))
            .run();
        }
      });
    }
    return rows.length;
  }

  /**
   * The same deterministic personality as the real `trickle` container (see
   * `compose-containers.yaml`), plus a daily half-hour outage and the odd throttle, so every event
   * type shows up
   */
  private fakeEvent(ms: number, containerId: number): InferInsertModel<typeof $containerEvent> | undefined {
    const CALLS = [
      ["GET", "/"],
      ["GET", "/health"],
      ["POST", "/api/orders"],
      ["GET", "/api/orders/8821"],
      ["PUT", "/assets/app.css"],
      ["DELETE", "/login"],
    ] as const;
    const STATUS_BY_RESIDUE: Record<number, number> = { 5: 201, 6: 304, 7: 404, 8: 500 };

    const timestamp = Temporal.Instant.fromEpochMilliseconds(ms);
    const i = ms / this.SPACING; // an integer, `ms` is spacing-aligned
    const common = {
      id: Uuid.toBytes(Bun.randomUUIDv7("hex", ms)),
      containerId,
      timestamp: timestamp.toString(),
    };

    const daySlot = i % 144; // 144 ten-minute slots per UTC day: the outage runs 16:40-17:10 daily
    if (daySlot === 100) {
      return { ...common, type: ContainerEvent.Type.stop };
    }
    if (daySlot === 101 || daySlot === 102) {
      return undefined; // downtime is silent
    }
    if (daySlot === 103) {
      return { ...common, type: ContainerEvent.Type.start };
    }
    if (i % 61 === 0) {
      return { ...common, type: ContainerEvent.Type.log_throttle, dropCount: ((i * 7) % 90) + 10 };
    }

    const [method, path] = CALLS[i % 6]!;
    const status = STATUS_BY_RESIDUE[(i * 3) % 10] ?? 200;
    return {
      ...common,
      type: ContainerEvent.Type.log,
      streamVariant: StreamVariant.stdout,
      line: `${timestamp.toString().slice(11, 19)} "${method} ${path}" ${status} ${((i * 37) % 400) + 3}ms`,
    };
  }
}
