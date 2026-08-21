import { ContainerEvent } from "@/models/ContainerEvent";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it } from "bun:test";
import { firstValueFrom, take, toArray } from "rxjs";
import { Fountain as Fountain } from "./Fountain";
import { StreamVariant } from "@/models/StreamVariant";
import { ThrottleService } from "./ThrottleService";

describe(Fountain.name, () => {
  let context: TestEnvironment.Context;
  let fountain: Fountain;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    fountain = new Fountain(context.dockerSocketMock.cast(), new ThrottleService(context.env));
    context.dockerSocketMock.listRunningContainers.mockResolvedValue([]);
    context.dockerSocketMock.streamLifecycles.mockImplementation(silent);
    context.dockerSocketMock.streamLogLines.mockImplementation(silent);
  });

  it("should follow the logs of containers that were already running, without inventing a start", async () => {
    // given
    const container = TestFixture.container();
    context.dockerSocketMock.listRunningContainers.mockResolvedValue([container]);
    context.dockerSocketMock.streamLogLines.mockImplementation(async function* () {
      yield { streamVariant: StreamVariant.stdout, timestamp: Temporal.Now.instant(), line: "listening on 3000" };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.streamEvents().pipe(take(1), toArray()));
    // then (the log arrives on its own -- dolog did not witness this container start)
    expect(events).toEqual([
      expect.objectContaining({ type: ContainerEvent.Type.log, container, line: "listening on 3000" } satisfies Partial<ContainerEvent>),
    ]);
  });

  it("should map docker's lifecycle events onto start and stop", async () => {
    // given
    const container = TestFixture.container();
    context.dockerSocketMock.streamLifecycles.mockImplementation(async function* () {
      yield { status: "start", timestamp: Temporal.Now.instant(), container };
      yield { status: "die", timestamp: Temporal.Now.instant(), container };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.streamEvents().pipe(take(2), toArray()));
    // then
    expect(events).toEqual([
      expect.objectContaining({ type: ContainerEvent.Type.start, container } satisfies Partial<ContainerEvent>),
      expect.objectContaining({ type: ContainerEvent.Type.stop, container } satisfies Partial<ContainerEvent>),
    ]);
  });

  it("should not attach twice when a container is both listed and announced", async () => {
    // given (the container started in the window between opening the event stream and listing)
    const container = TestFixture.container();
    context.dockerSocketMock.listRunningContainers.mockResolvedValue([container]);
    context.dockerSocketMock.streamLifecycles.mockImplementation(async function* () {
      yield { status: "start", timestamp: Temporal.Now.instant(), container };
      await never();
    });
    context.dockerSocketMock.streamLogLines.mockImplementation(async function* () {
      yield { streamVariant: StreamVariant.stdout, timestamp: Temporal.Now.instant(), line: "once" };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.streamEvents().pipe(take(2), toArray()));
    // then (the real start survives, and its logs are followed exactly once)
    expect(events).toEqual([
      expect.objectContaining({ type: ContainerEvent.Type.start } satisfies Partial<ContainerEvent>),
      expect.objectContaining({ type: ContainerEvent.Type.log, line: "once" } satisfies Partial<ContainerEvent>),
    ]);
    expect(context.dockerSocketMock.streamLogLines).toHaveBeenCalledTimes(1);
  });

  it("should keep going when one container's logs fail", async () => {
    // given
    const broken = TestFixture.container({ name: "broken" });
    const healthy = TestFixture.container({ name: "healthy" });
    context.dockerSocketMock.listRunningContainers.mockResolvedValue([broken, healthy]);
    let brokenAttempts = 0;
    context.dockerSocketMock.streamLogLines.mockImplementation(async function* (id: string) {
      if (id === broken.id) {
        // fails once and then simply says nothing, rather than failing forever: a stream that is
        // permanently broken is now permanently *retried*, which would spin for the rest of the suite
        if (++brokenAttempts === 1) {
          throw new Error("stream exploded");
        }
        await never();
      }
      yield { streamVariant: StreamVariant.stdout, timestamp: Temporal.Now.instant(), line: "still here" };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.streamEvents().pipe(take(1), toArray()));
    // then (the broken stream does not take the healthy one with it)
    expect(events).toEqual([expect.objectContaining({ container: healthy, line: "still here" } satisfies Partial<ContainerEvent>)]);
  });

  /**
   * A follow that ends is a container gone quiet for the life of the process, which looks exactly
   * like a container with nothing to say. Both endings have to be re-attached, and neither may be
   * re-attached once the container is actually gone.
   */
  describe("a log stream that ends", () => {
    it("should be re-attached after it fails", async () => {
      // given (the first attach dies the way a socket hiccup or a daemon restart would end it)
      const container = TestFixture.container();
      context.dockerSocketMock.listRunningContainers.mockResolvedValue([container]);
      let attempt = 0;
      context.dockerSocketMock.streamLogLines.mockImplementation(async function* () {
        if (++attempt === 1) {
          throw new Error("socket closed");
        }
        yield { streamVariant: StreamVariant.stdout, timestamp: Temporal.Now.instant(), line: "back" };
        await never();
      });

      // when
      const events = await firstValueFrom(fountain.streamEvents().pipe(take(1), toArray()));
      // then (followed again, rather than lost until the container itself restarts)
      expect(events).toEqual([expect.objectContaining({ container, line: "back" } satisfies Partial<ContainerEvent>)]);
      expect(context.dockerSocketMock.streamLogLines).toHaveBeenCalledTimes(2);
    });

    it("should be re-attached after it closes cleanly", async () => {
      // given (no error at all -- the generator simply returns, which docker does on its own restart)
      const container = TestFixture.container();
      context.dockerSocketMock.listRunningContainers.mockResolvedValue([container]);
      let attempt = 0;
      context.dockerSocketMock.streamLogLines.mockImplementation(async function* () {
        if (++attempt === 1) {
          return;
        }
        yield { streamVariant: StreamVariant.stdout, timestamp: Temporal.Now.instant(), line: "back" };
        await never();
      });

      // when
      const events = await firstValueFrom(fountain.streamEvents().pipe(take(1), toArray()));
      // then (a clean ending is still an ending, and needs the same answer as a failure)
      expect(events).toEqual([expect.objectContaining({ container, line: "back" } satisfies Partial<ContainerEvent>)]);
      expect(context.dockerSocketMock.streamLogLines).toHaveBeenCalledTimes(2);
    });

    it("should not be re-attached once the container has stopped", async () => {
      // given (a container that stops, whose log stream ends because there is nothing left to follow)
      const container = TestFixture.container();
      context.dockerSocketMock.streamLifecycles.mockImplementation(async function* () {
        yield { status: "start", timestamp: Temporal.Now.instant(), container };
        yield { status: "die", timestamp: Temporal.Now.instant(), container };
        await never();
      });
      context.dockerSocketMock.streamLogLines.mockImplementation(async function* () {
        return; // docker has nothing more to give for a container that is no longer running
      });

      // when (long enough for several reconnects, had anything been trying)
      const events = await firstValueFrom(fountain.streamEvents().pipe(take(2), toArray()));
      await Bun.sleep(400); // room for the first few backoff steps, had anything been trying

      // then (re-attaching forever to a container that is gone is worse than never re-attaching)
      expect(events.map((event) => event.type)).toEqual([ContainerEvent.Type.start, ContainerEvent.Type.stop]);
      expect(context.dockerSocketMock.streamLogLines).toHaveBeenCalledTimes(1);
    });
  });

  it("should hand out the same stream every time it is initialized", () => {
    // then
    expect(fountain.streamEvents()).toBe(fountain.streamEvents());
  });
});

async function* silent(): AsyncGenerator<never> {
  await never();
}

function never(): Promise<never> {
  return new Promise<never>(() => {});
}
