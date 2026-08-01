import { ContainerEvent } from "@/models/ContainerEvent";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { Temporal } from "@js-temporal/polyfill";
import { beforeEach, describe, expect, it } from "bun:test";
import { firstValueFrom, take, toArray } from "rxjs";
import { DockerFountain } from "./DockerFountain";

describe(DockerFountain.name, () => {
  let context: TestEnvironment.Context;
  let fountain: DockerFountain;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    fountain = new DockerFountain(context.dockerSocketMock.cast());
    context.dockerSocketMock.hasTty.mockResolvedValue(false);
    context.dockerSocketMock.listRunningContainers.mockResolvedValue([]);
    context.dockerSocketMock.streamLifecycle.mockImplementation(silent);
    context.dockerSocketMock.streamLogs.mockImplementation(silent);
  });

  it("should announce containers that were already running, then follow their logs", async () => {
    // given
    const container = TestFixture.container();
    context.dockerSocketMock.listRunningContainers.mockResolvedValue([container]);
    context.dockerSocketMock.streamLogs.mockImplementation(async function* () {
      yield { stream: ContainerEvent.Stream.stdout, timestamp: Temporal.Now.instant(), message: "listening on 3000" };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.initialize().pipe(take(2), toArray()));
    // then
    expect(events).toEqual([
      expect.objectContaining({ type: ContainerEvent.Type.start, container }),
      expect.objectContaining({ type: ContainerEvent.Type.log, container, message: "listening on 3000" }),
    ]);
  });

  it("should map docker's lifecycle events onto start and stop", async () => {
    // given
    const container = TestFixture.container();
    context.dockerSocketMock.streamLifecycle.mockImplementation(async function* () {
      yield { status: "start" as const, timestamp: Temporal.Now.instant(), container };
      yield { status: "die" as const, timestamp: Temporal.Now.instant(), container };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.initialize().pipe(take(2), toArray()));
    // then
    expect(events).toEqual([
      expect.objectContaining({ type: ContainerEvent.Type.start, container }),
      expect.objectContaining({ type: ContainerEvent.Type.stop, container }),
    ]);
  });

  it("should not attach twice when a container is both listed and announced", async () => {
    // given (the container was already up, and docker reports its start as well)
    const container = TestFixture.container();
    context.dockerSocketMock.listRunningContainers.mockResolvedValue([container]);
    context.dockerSocketMock.streamLifecycle.mockImplementation(async function* () {
      yield { status: "start" as const, timestamp: Temporal.Now.instant(), container };
      await never();
    });
    context.dockerSocketMock.streamLogs.mockImplementation(async function* () {
      yield { stream: ContainerEvent.Stream.stdout, timestamp: Temporal.Now.instant(), message: "once" };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.initialize().pipe(take(2), toArray()));
    // then (one start, one log -- not a duplicated log stream)
    expect(events).toEqual([
      expect.objectContaining({ type: ContainerEvent.Type.start }),
      expect.objectContaining({ type: ContainerEvent.Type.log, message: "once" }),
    ]);
    expect(context.dockerSocketMock.streamLogs).toHaveBeenCalledTimes(1);
  });

  it("should keep going when one container's logs fail", async () => {
    // given
    const broken = TestFixture.container({ name: "broken" });
    const healthy = TestFixture.container({ name: "healthy" });
    context.dockerSocketMock.listRunningContainers.mockResolvedValue([broken, healthy]);
    context.dockerSocketMock.streamLogs.mockImplementation(async function* (id: string) {
      if (id === broken.id) {
        throw new Error("stream exploded");
      }
      yield { stream: ContainerEvent.Stream.stdout, timestamp: Temporal.Now.instant(), message: "still here" };
      await never();
    });

    // when
    const events = await firstValueFrom(fountain.initialize().pipe(take(3), toArray()));
    // then
    expect(events.filter((event) => event.type === ContainerEvent.Type.log)).toEqual([
      expect.objectContaining({ container: healthy, message: "still here" }),
    ]);
  });

  it("should hand out the same stream every time it is initialized", () => {
    // then
    expect(fountain.initialize()).toBe(fountain.initialize());
  });
});

async function* silent(): AsyncGenerator<never> {
  await never();
}

function never(): Promise<never> {
  return new Promise<never>(() => {});
}
