import { Env } from "@/Env";
import { DockerError } from "@/errors/DockerError";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerLabelConfig } from "@/models/ContainerLabelConfig";
import { Host } from "@/models/Host";
import { StreamVariant } from "@/models/StreamVariant";
import { EventRepository } from "@/repositories/EventRepository";
import { Temporal } from "@js-temporal/polyfill";
import { cpus, totalmem } from "node:os";
import { Source } from "../contracts/Source";

/**
 * A fleet of invented containers for the interactive demo, standing in for the docker socket.
 *
 * Time is cut into slots per container, and each slot is written once: for the history seeded at startup
 * and for the lines streamed live afterwards alike, so the two tell one story.
 */
export class DemoSocket implements Source {
  private readonly log = new Logger(__filename);
  // per container: the first slot the live stream has yet to emit, so a re-attached stream neither repeats nor skips a line
  private readonly cursors = new Map<string, number>();
  private readonly lifecycleCursors = new Map<string, number>();

  public constructor(
    private readonly env: Env.Private,
    private readonly eventRepository: EventRepository,
    private readonly clock: () => number = () => Date.now(), // overridable for unit tests
  ) {}

  @Initialize
  public async inventHistory(): Promise<void> {
    const started = performance.now();
    const now = this.clock();
    const events: ContainerEvent[] = [];
    for (const personality of Internal.FLEET) {
      const budget = ContainerLabelConfig.resolve(this.env, personality.container.dlabels).config.throttlingLogsPerSecond;
      const last = Internal.lastHistoricSlot(personality, now);
      events.push(...Internal.history(personality, Internal.slotAt(personality, now - personality.depth), last, budget));
      this.cursors.set(personality.container.did, last + 1);
      this.lifecycleCursors.set(personality.container.did, last + 1);
    }
    await this.eventRepository.saveHistory(events);
    this.log.info(
      `Invented ${events.length} events for ${Internal.FLEET.length} containers in ${Math.round(performance.now() - started)} ms`,
    );
  }

  public async listRunningContainers(): Promise<Container[]> {
    const now = this.clock();
    return Internal.FLEET.filter((p) => Internal.isUp(p, Internal.slotAt(p, now))).map((p) => p.container);
  }

  public async inspectHost(): Promise<Host.Identity> {
    return { hostname: "demo", dockerVersion: "28.3.2", cpuTotal: cpus().length, memoryTotal: totalmem() };
  }

  public async *streamLifecycles(signal: AbortSignal): AsyncGenerator<Source.Lifecycle> {
    while (true) {
      let next: { personality: Internal.Personality; slot: number; status: "start" | "die" } | undefined;
      for (const personality of Internal.FLEET.filter((p) => p.outage && !p.stoppedAgo)) {
        const from = this.lifecycleCursors.get(personality.container.did) ?? Internal.slotAt(personality, this.clock()) + 1;
        // an outage recurs every period, so the next transition is at most one period away
        for (let slot = from; slot < from + personality.outage!.period; slot += 1) {
          const status = Internal.lifecycleAt(personality, slot);
          if (status) {
            if (!next || Internal.slotTime(personality, slot) < Internal.slotTime(next.personality, next.slot)) {
              next = { personality, slot, status };
            }
            break;
          }
        }
      }
      if (!next) {
        return;
      }
      const at = Internal.slotTime(next.personality, next.slot);
      await this.sleepUntil(at, signal);
      this.lifecycleCursors.set(next.personality.container.did, next.slot + 1);
      yield { status: next.status, timestamp: Temporal.Instant.fromEpochMilliseconds(at), container: next.personality.container };
    }
  }

  public async *streamLogLines(id: string, signal: AbortSignal): AsyncGenerator<Source.LogLine> {
    const personality = this.find(id);
    while (true) {
      const slot = this.cursors.get(id) ?? Internal.slotAt(personality, this.clock()) + 1;
      await this.sleepUntil(Internal.slotTime(personality, slot), signal);
      this.cursors.set(id, slot + 1);
      if (!Internal.isUp(personality, slot)) {
        continue;
      }
      for (const { at, streamVariant, line } of Internal.linesAt(personality, slot)) {
        await this.sleepUntil(at, signal);
        yield { streamVariant, timestamp: Temporal.Instant.fromEpochMilliseconds(at), line };
      }
    }
  }

  public async *streamStats(id: string, signal: AbortSignal): AsyncGenerator<Source.Stats> {
    const SAMPLE_INTERVAL = Temporal.Duration.from({ seconds: 1 }).total("milliseconds");
    const personality = this.find(id);
    while (true) {
      const now = this.clock();
      yield personality.stats(now);
      await this.sleepUntil(now - (now % SAMPLE_INTERVAL) + SAMPLE_INTERVAL, signal);
    }
  }

  private find(id: string): Internal.Personality {
    const personality = Internal.FLEET.find((p) => p.container.did === id);
    if (!personality) {
      throw DockerError.unknown_container({ id });
    }
    return personality;
  }

  private async sleepUntil(ms: number, signal: AbortSignal): Promise<void> {
    const delay = ms - this.clock();
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delay);
        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
    signal.throwIfAborted();
  }
}

namespace Internal {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const MIB = 1024 * 1024;

  export type Line = { at: number; streamVariant: StreamVariant; line: string };
  export type Personality = {
    container: Container;
    spacing: number; // ms between slots
    depth: number; // ms of history to invent
    outage?: { period: number; down: number }; // in slots: the last `down` of every `period` are downtime, a `die` then a `start`
    stoppedAgo?: number; // ms since it stopped for good
    // what the slot writes, as offsets into it; `farewell` marks the last slot of a container that stops for good
    lines: (
      slot: number,
      at: Temporal.Instant,
      farewell: boolean,
    ) => Array<{ offset?: number; streamVariant?: StreamVariant; line: string }>;
    stats: (ms: number) => Source.Stats;
  };

  export const slotAt = (p: Personality, ms: number): number => Math.floor(ms / p.spacing);
  export const slotTime = (p: Personality, slot: number): number => slot * p.spacing;

  export function lastHistoricSlot(p: Personality, now: number): number {
    return p.stoppedAgo ? slotAt(p, now - p.stoppedAgo) - 1 : slotAt(p, now);
  }

  /** Whether the slot fell inside an outage, which is the same question for history and for now */
  function wasUp(p: Personality, slot: number): boolean {
    return !p.outage || slot % p.outage.period < p.outage.period - p.outage.down;
  }

  export function isUp(p: Personality, slot: number): boolean {
    return !p.stoppedAgo && wasUp(p, slot);
  }

  export function lifecycleAt(p: Personality, slot: number): "start" | "die" | undefined {
    if (!p.outage) {
      return undefined;
    }
    const phase = slot % p.outage.period;
    return phase === 0 ? "start" : phase === p.outage.period - p.outage.down ? "die" : undefined;
  }

  /** The slot's lines at their instants; the first millisecond is left to a `start` that shares the slot */
  export function linesAt(p: Personality, slot: number, farewell = false): Line[] {
    const base = slotTime(p, slot) + 1;
    return p
      .lines(slot, Temporal.Instant.fromEpochMilliseconds(base), farewell)
      .map(({ offset = 0, streamVariant = StreamVariant.stdout, line }) => ({ at: base + offset, streamVariant, line }));
  }

  /**
   * The events the repository would hold had dolog been watching all along: the lines the throttle
   * would have let through, a throttle event for the rest, and the restarts
   */
  export function history(p: Personality, first: number, last: number, budget: number): ContainerEvent[] {
    const events: ContainerEvent[] = [];
    const common = (ms: number) => ({
      object: "container_event" as const,
      id: Bun.randomUUIDv7("hex", ms),
      timestamp: Temporal.Instant.fromEpochMilliseconds(ms),
      container: p.container,
    });
    for (let slot = first; slot <= last; slot += 1) {
      const lifecycle = lifecycleAt(p, slot);
      if (lifecycle === "die") {
        events.push({ ...common(slotTime(p, slot)), type: ContainerEvent.Type.stop });
      }
      if (lifecycle === "start" || (slot === first && wasUp(p, slot))) {
        events.push({ ...common(slotTime(p, slot)), type: ContainerEvent.Type.start });
      }
      if (!wasUp(p, slot)) {
        continue;
      }
      const lines = linesAt(p, slot, slot === last && Boolean(p.stoppedAgo));
      for (const { at, streamVariant, line } of lines.slice(0, budget)) {
        events.push({ ...common(at), type: ContainerEvent.Type.log, streamVariant, line });
      }
      if (lines.length > budget) {
        // the throttle reports at the close of its one-second window
        events.push({ ...common(slotTime(p, slot) + SECOND), type: ContainerEvent.Type.log_throttle, dropCount: lines.length - budget });
      }
    }
    if (p.stoppedAgo) {
      events.push({ ...common(slotTime(p, last + 1)), type: ContainerEvent.Type.stop });
    }
    return events;
  }

  // v-- the fleet --v

  const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
  const between = (low: number, high: number): number => low + Math.floor(Math.random() * (high - low + 1));

  /** Between `low` and `high`, drifting slowly and trembling a little, so a meter looks alive rather than random */
  function wobble(ms: number, low: number, high: number, phase: number): number {
    const drift = 0.5 + 0.5 * Math.sin((2 * Math.PI * ms) / (7 * MINUTE) + phase);
    const tremble = (Math.random() - 0.5) * 0.1;
    return low + (high - low) * Math.min(1, Math.max(0, drift + tremble));
  }

  function did(name: string): string {
    return new Bun.CryptoHasher("sha256").update(`dolog-demo:${name}`).digest("hex");
  }

  function container(dname: string, dimage: string, dgroup: string, dlabels: Record<string, string> = {}): Container {
    return { object: "container", did: did(dname), dname, dgroup, dimage, dlabels };
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number, width = 2) => n.toString().padStart(width, "0");

  // `Date` rather than a zoned Temporal: the polyfill's zone arithmetic would be most of the seeding time
  /** `23/Sep/2026:06:52:27 +0000` */
  function nginxDate(at: Temporal.Instant): string {
    const t = new Date(at.epochMilliseconds);
    return `${pad(t.getUTCDate())}/${MONTHS[t.getUTCMonth()]}/${t.getUTCFullYear()}:${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())} +0000`;
  }

  /** `2026-09-23 06:52:27.001 UTC` */
  function postgresDate(at: Temporal.Instant): string {
    return `${at.toString().slice(0, 23).replace("T", " ")} UTC`;
  }

  /** `23 Sep 2026 06:52:27.001` */
  function redisDate(at: Temporal.Instant): string {
    const t = new Date(at.epochMilliseconds);
    return `${pad(t.getUTCDate())} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}.${pad(t.getUTCMilliseconds(), 3)}`;
  }

  const web: Personality = {
    container: container("web", "nginx:1.27-alpine", "shop", { "alerting.text-pattern": '" 500 ' }),
    spacing: SECOND,
    depth: 6 * HOUR,
    lines: (_slot, at) => {
      const PATHS = [
        "/",
        "/products",
        "/products/4471",
        "/products/1208",
        "/cart",
        "/checkout",
        "/api/orders",
        "/api/orders/8821",
        "/static/app.css",
      ];
      const probing = Math.random() < 0.04;
      const path = probing ? pick(["/wp-login.php", "/.env", "/admin/config.php", "/xmlrpc.php"]) : pick(PATHS);
      const method = path === "/api/orders" && Math.random() < 0.6 ? "POST" : "GET";
      const luck = Math.random();
      const status = probing ? 404 : luck < 0.004 ? 500 : luck < 0.02 ? 404 : luck < 0.2 ? 304 : method === "POST" ? 201 : 200;
      const bytes = status === 304 ? 0 : between(180, 14_180);
      const ip = `${pick(["203.0.113", "198.51.100", "192.0.2"])}.${between(1, 254)}`;
      return [{ line: `${ip} - - [${nginxDate(at)}] "${method} ${path} HTTP/1.1" ${status} ${bytes}` }];
    },
    stats: (ms) => ({
      cpuUsage: wobble(ms, 0.01, 0.06, 1),
      cpuTotal: 2,
      memoryUsage: wobble(ms, 22 * MIB, 31 * MIB, 11),
      memoryTotal: 128 * MIB,
    }),
  };

  const api: Personality = {
    container: container("api", "node:22-alpine", "shop"),
    spacing: 2 * SECOND,
    depth: 6 * HOUR,
    lines: (_slot, at) => {
      const entry = (fields: Record<string, unknown>, level = "info") => JSON.stringify({ level, time: at.toString(), ...fields });
      if (Math.random() < 0.008) {
        return [
          {
            streamVariant: StreamVariant.stderr,
            line: entry({ msg: "request failed", method: "POST", path: "/orders", err: "read ECONNRESET" }, "error"),
          },
          { offset: 1, streamVariant: StreamVariant.stderr, line: "Error: read ECONNRESET" },
          { offset: 2, streamVariant: StreamVariant.stderr, line: "    at TCP.onStreamRead (node:internal/stream_base_commons:218:20)" },
          {
            offset: 3,
            streamVariant: StreamVariant.stderr,
            line: "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
          },
        ];
      }
      const orderId = `ord_${between(10_000, 99_999)}`;
      const amount = between(0, 24_000) / 100;
      const kind = Math.random();
      if (kind < 0.55) {
        const path = pick(["/products", "/products/4471", "/cart", "/orders", `/orders/${orderId}`, "/me"]);
        const status = Math.random() < 0.03 ? 404 : path === "/orders" ? 201 : 200;
        return [
          {
            line: entry({
              msg: "request completed",
              method: path === "/orders" ? "POST" : "GET",
              path,
              status,
              ms: between(3, 182),
            }),
          },
        ];
      }
      if (kind < 0.75) {
        return [{ line: entry({ msg: "order placed", orderId, items: between(1, 5), total: amount }) }];
      }
      if (kind < 0.85) {
        return [{ line: entry({ msg: "payment captured", orderId, provider: "stripe", amount }) }];
      }
      if (kind < 0.95) {
        return [{ line: entry({ msg: Math.random() < 0.7 ? "cache hit" : "cache miss", key: `product:${between(1000, 5999)}` }) }];
      }
      return [
        {
          line: entry(
            {
              msg: "slow query",
              query: "select * from orders where customer_id = $1 order by created_at desc",
              ms: between(400, 1299),
            },
            "warn",
          ),
        },
      ];
    },
    stats: (ms) => ({
      cpuUsage: wobble(ms, 0.08, 0.45, 2),
      cpuTotal: 2,
      memoryUsage: wobble(ms, 180 * MIB, 260 * MIB, 12),
      memoryTotal: 512 * MIB,
    }),
  };

  const db: Personality = {
    container: container("db", "postgres:16-alpine", "shop"),
    spacing: 5 * MINUTE,
    depth: 3 * DAY,
    lines: (slot, at) => {
      const entry = (offset: number, pid: number, message: string) => ({
        offset,
        streamVariant: StreamVariant.stderr,
        line: `${postgresDate(at.add({ milliseconds: offset }))} [${pid}] ${message}`,
      });
      const lines: Array<{ offset: number; streamVariant: StreamVariant; line: string }> = [];
      if (slot % 3 === 0) {
        const buffers = between(80, 479);
        lines.push(entry(0, 28, "LOG:  checkpoint starting: time"));
        lines.push(
          entry(
            14_300,
            28,
            `LOG:  checkpoint complete: wrote ${buffers} buffers (${(buffers / 163.84).toFixed(1)}%); 0 WAL file(s) added, 0 removed, 1 recycled; write=14.2 s, sync=0.01 s, total=14.3 s`,
          ),
        );
      }
      if (Math.random() < 0.15) {
        lines.push(
          entry(
            40_000,
            1180 + (slot % 200),
            'LOG:  automatic vacuum of table "shop.public.orders": index scans: 1, pages: 0 removed, 412 remain, tuples: 233 removed, 18740 remain',
          ),
        );
      }
      if (Math.random() < 0.08) {
        lines.push(
          entry(
            120_000,
            57,
            `LOG:  duration: ${(800 + Math.random() * 2500).toFixed(3)} ms  statement: SELECT o.*, c.email FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status = 'pending'`,
          ),
        );
      }
      if (Math.random() < 0.03) {
        lines.push(entry(200_000, 57, "WARNING:  there is no transaction in progress"));
      }
      return lines;
    },
    stats: (ms) => ({
      cpuUsage: wobble(ms, 0.03, 0.25, 3),
      cpuTotal: 2,
      memoryUsage: wobble(ms, 640 * MIB, 810 * MIB, 13),
      memoryTotal: 1024 * MIB,
    }),
  };

  // runs out of heap every ten minutes, and compose brings it back a minute later
  const WORKER_PERIOD = 30;
  const worker: Personality = {
    container: container("worker", "shop/worker:2.4.1", "shop"),
    spacing: 20 * SECOND,
    depth: DAY,
    outage: { period: WORKER_PERIOD, down: 3 },
    lines: (slot) => {
      const phase = slot % WORKER_PERIOD;
      if (phase === 0) {
        return [
          { line: "[worker] shop-worker v2.4.1 starting, 4 queues (images, mail, exports, webhooks)" },
          { offset: 90, line: "[worker] connected to postgres://db:5432/shop" },
        ];
      }
      if (phase === WORKER_PERIOD - 4) {
        return [
          { streamVariant: StreamVariant.stderr, line: "<--- Last few GCs --->" },
          {
            offset: 1,
            streamVariant: StreamVariant.stderr,
            line: "[1:0x5f2a8c0]  598214 ms: Mark-Compact 507.9 (520.3) -> 506.8 (520.5) MB, 812.4 / 0.0 ms  (average mu = 0.108, current mu = 0.032) allocation failure; scavenge might not succeed",
          },
          {
            offset: 2,
            streamVariant: StreamVariant.stderr,
            line: "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
          },
        ];
      }
      const queue = pick(["images", "mail", "exports", "webhooks"]);
      const jobId = `job_${(slot * 7919) % 100_000}`;
      const duration = between(120, 2519);
      const lines: Array<{ offset?: number; line: string }> = [
        { line: `[worker] ${queue}: picked up ${jobId}` },
        { offset: duration, line: `[worker] ${queue}: ${jobId} done in ${duration}ms` },
      ];
      if (phase % 5 === 0) {
        lines.push({ offset: 3000, line: `[worker] heap ${96 + phase * 15 + between(0, 9)} MB / 512 MB` });
      }
      return lines;
    },
    stats: (ms) => {
      const phase = Math.floor(ms / (20 * SECOND)) % WORKER_PERIOD;
      return {
        cpuUsage: wobble(ms, 0.05, 0.5, 4),
        cpuTotal: 2,
        memoryUsage: (96 + phase * 15) * MIB + wobble(ms, 0, 8 * MIB, 14),
        memoryTotal: 512 * MIB,
      };
    },
  };

  // a burst every half minute that blows through its budget, so the throttle has something to do
  const collector: Personality = {
    container: container("collector", "acme/telemetry-collector:1.8.3", "monitoring", { "throttling.logs-per-second": "50" }),
    spacing: 30 * SECOND,
    depth: 30 * MINUTE,
    lines: () => {
      const BURST = 300;
      return Array.from({ length: BURST }, (_, k) => ({
        offset: k * 3,
        line: `info  exporter/otlp  flushed batch ${k + 1}/${BURST}: ${between(20, 419)} spans, ${between(0, 59)} metrics -> backend:4317 (${between(2, 41)}ms)`,
      }));
    },
    stats: (ms) => {
      const burst = ms % (30 * SECOND) < 2 * SECOND ? 0.7 : 0;
      return {
        cpuUsage: burst + wobble(ms, 0.02, 0.06, 5),
        cpuTotal: 2,
        memoryUsage: wobble(ms, 84 * MIB, 96 * MIB, 15),
        memoryTotal: 256 * MIB,
      };
    },
  };

  // gone since the day before yesterday, and nobody noticed
  const cache: Personality = {
    container: container("cache", "redis:7-alpine", "shop"),
    spacing: 5 * MINUTE,
    depth: 3 * DAY,
    stoppedAgo: 2 * DAY,
    lines: (_slot, at, farewell) => {
      const entry = (offset: number, message: string) => ({
        offset,
        line: `1:M ${redisDate(at.add({ milliseconds: offset }))} ${message}`,
      });
      if (farewell) {
        return [
          { offset: 0, line: `1:signal-handler (${Math.floor(at.epochMilliseconds / SECOND)}) Received SIGTERM scheduling shutdown...` },
          entry(40, "# User requested shutdown..."),
          entry(41, "* Saving the final RDB snapshot before exiting."),
          entry(230, "* DB saved on disk"),
          entry(231, "# Redis is now ready to exit, bye bye..."),
        ];
      }
      const changes = between(1, 40);
      return [
        entry(0, `* ${changes} changes in 300 seconds. Saving...`),
        entry(2, "* Background saving started by pid 41"),
        entry(180, "* DB saved on disk"),
      ];
    },
    stats: () => ({ cpuUsage: 0, cpuTotal: 2, memoryUsage: 0, memoryTotal: 64 * MIB }),
  };

  export const FLEET: Personality[] = [web, api, db, worker, collector, cache];
}
