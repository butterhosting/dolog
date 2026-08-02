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
    const events = await firstValueFrom(fountain.stream().pipe(take(1), toArray()));
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
    const events = await firstValueFrom(fountain.stream().pipe(take(2), toArray()));
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
    const events = await firstValueFrom(fountain.stream().pipe(take(2), toArray()));
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
    context.dockerSocketMock.streamLogLines.mockImplementation(async function* (id: string) {
      if (id === broken.id) {
        throw new Error("stream exploded");
      }
      yield { streamVariant: StreamVariant.stdout, timestamp: Temporal.Now.instant(), line: "still here" };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.stream().pipe(take(1), toArray()));
    // then (the broken stream is swallowed, the healthy one keeps flowing)
    expect(events).toEqual([expect.objectContaining({ container: healthy, line: "still here" } satisfies Partial<ContainerEvent>)]);
  });

  it("should hand out the same stream every time it is initialized", () => {
    // then
    expect(fountain.stream()).toBe(fountain.stream());
  });
});

async function* silent(): AsyncGenerator<never> {
  await never();
}

function never(): Promise<never> {
  return new Promise<never>(() => {});
}
