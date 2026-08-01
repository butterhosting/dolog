import { ContainerEvent } from "@/models/ContainerEvent";
import { Throughput } from "@/models/Throughput";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { TestScheduler } from "rxjs/testing";
import { ThrottleService } from "./ThrottleService";

/**
 * The throttler is built on time-based operators, so these run on rxjs' virtual clock: a "1000ms"
 * window closes instantly.
 */
describe(ThrottleService.name, () => {
  let context: TestEnvironment.Context;
  let service: ThrottleService;
  let scheduler: TestScheduler;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    service = new ThrottleService(context.env);
    scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
  });

  it("should pass everything through while the container stays under budget", () => {
    // given (the budget is 5 logs per second)
    const container = TestFixture.container();
    const events = { a: log(container, "one"), b: log(container, "two"), c: log(container, "three") };

    scheduler.run(({ cold, expectObservable }) => {
      // when
      const throttled = service.throttle(cold("(abc)", events));
      // then
      expectObservable(throttled, "^ 1500ms !").toBe("(abc)", events);
    });
  });

  it("should fold everything past the budget into one throttle event at the end of the window", () => {
    // given (7 logs against a budget of 5)
    const container = TestFixture.container();
    const events = {
      a: log(container, "1"),
      b: log(container, "2"),
      c: log(container, "3"),
      d: log(container, "4"),
      e: log(container, "5"),
      f: log(container, "6"),
      g: log(container, "7"),
    };

    scheduler.run(({ cold, expectObservable }) => {
      // when
      const throttled = service.throttle(cold("(abcdefg)", events));
      // then (the first five pass immediately, the other two surface as a single fold at 1000ms)
      expectObservable(throttled, "^ 1500ms !").toBe("(abcde) 993ms t", {
        ...events,
        t: expect.objectContaining({
          type: ContainerEvent.Type.throttle,
          container,
          foldCount: 2,
        }) as unknown as ContainerEvent,
      });
    });
  });

  it("should never throttle lifecycle events", () => {
    // given (a start, then more logs than the budget allows)
    const container = TestFixture.container();
    const start = TestFixture.startEvent({ container });
    const events = {
      s: start,
      a: log(container, "1"),
      b: log(container, "2"),
      c: log(container, "3"),
      d: log(container, "4"),
      e: log(container, "5"),
      f: log(container, "6"),
    };

    scheduler.run(({ cold, expectObservable }) => {
      // when
      const throttled = service.throttle(cold("(sabcdef)", events));
      // then (the start survives, only the sixth log is folded)
      expectObservable(throttled, "^ 1500ms !").toBe("(sabcde) 992ms t", {
        ...events,
        t: expect.objectContaining({ foldCount: 1 }) as unknown as ContainerEvent,
      });
    });
  });

  it("should budget each container separately", () => {
    // given (two containers, each within its own budget)
    const web = TestFixture.container({ name: "web" });
    const worker = TestFixture.container({ name: "worker" });
    const events = {
      a: log(web, "1"),
      b: log(web, "2"),
      c: log(web, "3"),
      x: log(worker, "1"),
      y: log(worker, "2"),
      z: log(worker, "3"),
    };

    scheduler.run(({ cold, expectObservable }) => {
      // when
      const throttled = service.throttle(cold("(abcxyz)", events));
      // then (nothing is folded, because neither container spent more than three of its five)
      expectObservable(throttled, "^ 1500ms !").toBe("(abcxyz)", events);
    });
  });

  it("should keep a live throughput reading per container", () => {
    // given
    const container = TestFixture.container();
    const events = { a: log(container, "hello"), b: log(container, "world") };
    const snapshots: Throughput[][] = [];

    scheduler.run(({ cold, expectObservable }) => {
      // when
      const throttled = service.throttle(cold("(ab)", events));
      expectObservable(throttled, "^ 1500ms !").toBe("(ab)", events);
      scheduler.schedule(() => snapshots.push(service.dashboard()), 1100);
    });

    // then ("hello" and "world" are 5 bytes each)
    expect(snapshots.at(0)).toEqual([
      expect.objectContaining({
        object: "throughput",
        container,
        logsPerSecond: 2,
        bytesPerSecond: 10,
        foldedPerSecond: 0,
      }),
    ]);
  });

  it("should forget a container once its stream is gone", () => {
    // given
    const container = TestFixture.container();
    const events = { a: log(container, "hello") };

    scheduler.run(({ cold, expectObservable }) => {
      // when
      const throttled = service.throttle(cold("a", events));
      expectObservable(throttled, "^ 1500ms !").toBe("a", events);
    });

    // then (the subscription ended, so the dashboard entry went with it)
    expect(service.dashboard()).toEqual([]);
  });
});

function log(container: ReturnType<typeof TestFixture.container>, message: string): ContainerEvent.Log {
  return TestFixture.logEvent({ container, message });
}
