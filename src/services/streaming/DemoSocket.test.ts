import { $container, $containerEvent } from "@/drizzle/schema";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Uuid } from "@/models/Uuid";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it } from "bun:test";
import { DemoSocket } from "./DemoSocket";

describe(DemoSocket.name, () => {
  const MINUTE = 60_000;
  const DAY = 24 * 60 * MINUTE;

  let context: TestEnvironment.Context;
  let now: number;
  let service: DemoSocket;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    now = Date.now();
    service = new DemoSocket(context.env, context.eventRepository, () => now);
    await service.inventHistory();
  });

  const history = () => {
    const names = new Map(
      context.sqlite
        .select()
        .from($container)
        .all()
        .map((row) => [row.id, row.dname]),
    );
    return context.sqlite
      .select()
      .from($containerEvent)
      .all()
      .map((row) => ({
        id: Buffer.from(row.id),
        at: Temporal.Instant.from(row.timestamp).epochMilliseconds,
        type: row.type,
        dname: names.get(row.containerId)!,
      }))
      .sort((a, b) => Buffer.compare(a.id, b.id));
  };

  const running = async () => (await service.listRunningContainers()).map((container) => container.dname);

  it("should invent a history whose ids carry their own instants, so paging by id is paging by time", async () => {
    // given
    const events = history();
    // then (a few days for the slow talkers, hours for the chatty ones; nothing from the future)
    expect(new Set(events.map((event) => event.dname))).toEqual(new Set(["web", "api", "db", "worker", "collector", "cache"]));
    expect(Math.min(...events.map((event) => event.at))).toBeLessThan(now - 2 * DAY);
    expect(Math.max(...events.map((event) => event.at))).toBeLessThanOrEqual(now);
    const stampedAtTheirOwnInstant = events.every((event) =>
      event.id.subarray(0, 6).equals(Uuid.lowerBoundAt(Temporal.Instant.fromEpochMilliseconds(event.at)).subarray(0, 6)),
    );
    expect(stampedAtTheirOwnInstant).toBe(true);
    expect(events.map((event) => event.at)).toEqual([...events.map((event) => event.at)].sort((a, b) => a - b));
  });

  it("should keep the throttle's side of the story: a burst is cut to its budget and counted", async () => {
    // given (the collector's label puts it at 50 a second, over the 5 of this test environment)
    const collector = history().filter((event) => event.dname === "collector");
    const throttles = collector.filter((event) => event.type === ContainerEvent.Type.log_throttle);
    // then
    expect(throttles.length).toBeGreaterThan(0);
    expect(collector.filter((event) => event.type === ContainerEvent.Type.log).length).toBe(throttles.length * 50);
  });

  it("should pick the live stream up exactly where the history left off", async () => {
    // given
    const web = history().filter((event) => event.dname === "web" && event.type === ContainerEvent.Type.log);
    const [beforeLast, last] = web.slice(-2).map((event) => event.at);
    const spacing = last! - beforeLast!;
    const did = (await service.listRunningContainers()).find((container) => container.dname === "web")!.did;
    const controller = new AbortController();

    // when (the clock moves past the next slot, and the sleep in between has nothing left to wait for)
    now = last! + spacing;
    const { value } = await service.streamLogLines(did, controller.signal).next();
    controller.abort();

    // then
    expect(value.timestamp.epochMilliseconds).toBe(last! + spacing);
    expect(value.line).toMatch(/HTTP\/1\.1" \d{3} /);
  });

  it("should list what is running: not the one that stopped for good, and not one mid-outage", async () => {
    // given
    const cache = history().filter((event) => event.dname === "cache");
    const controller = new AbortController();
    const lifecycles = service.streamLifecycles(controller.signal);

    // when (a whole outage period passes, so the worker's next transition is due)
    now += 10 * MINUTE;
    const first = (await lifecycles.next()).value;
    now = first.timestamp.epochMilliseconds;
    const runningAtFirst = await running();
    now += 10 * MINUTE;
    const second = (await lifecycles.next()).value;
    controller.abort();

    // then
    expect(cache.at(-1)?.type).toBe(ContainerEvent.Type.stop);
    expect(cache.at(-1)!.at).toBeLessThan(now - DAY);
    expect(runningAtFirst).not.toContain("cache");
    expect(first.container.dname).toBe("worker");
    expect(second.container.dname).toBe("worker");
    expect(runningAtFirst.includes("worker")).toBe(first.status === "start");
    expect(second.status).not.toBe(first.status);
    expect(second.timestamp.epochMilliseconds).toBeGreaterThan(first.timestamp.epochMilliseconds);
  });
});
