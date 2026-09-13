import { Initialize } from "@/Initialize";
import { Host } from "@/models/Host";
import { SocketService } from "@/services/SocketService";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { cpus } from "node:os";
import { HostService } from "./HostService";

describe(HostService.name, () => {
  const IDENTITY: Host.Identity = { hostname: "tnlap", dockerVersion: "29.4.0", cpuTotal: 10, memoryTotal: 16_000 };

  let context: TestEnvironment.Context;
  let broadcastHostStream: ReturnType<typeof mock>;
  let service: HostService;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    context.dockerSocketMock.inspectHost.mockResolvedValue(IDENTITY);
    broadcastHostStream = mock();
    service = new HostService(context.dockerSocketMock.cast(), { hasConnections: () => true, broadcastHostStream } as unknown as SocketService);
    await Initialize.runAll(service);
  });

  it("should name the host the way docker does, measure it itself, and push the sample to whoever is listening", async () => {
    // when (a sample needs two readings a second apart, so this takes about that long)
    const host = await service.get();
    // then (docker's half verbatim, and this machine's half within the bounds of a machine)
    expect(host).toEqual({ ...IDENTITY, cpuUsage: expect.any(Number), memoryUsage: expect.any(Number) });
    expect(host.cpuUsage).toBeGreaterThanOrEqual(0);
    expect(host.cpuUsage).toBeLessThanOrEqual(cpus().length);
    expect(host.memoryUsage).toBeGreaterThan(0);
    expect(broadcastHostStream).toHaveBeenCalledWith(host);
    expect(context.dockerSocketMock.inspectHost).toHaveBeenCalledTimes(1);
  });
});
