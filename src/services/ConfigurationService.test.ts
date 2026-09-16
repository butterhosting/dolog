import { Container } from "@/models/Container";
import { Svc } from "@/models/Svc";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { EMPTY } from "rxjs";
import { ConfigurationService } from "./ConfigurationService";
import { SocketService } from "./SocketService";
import { SvcService } from "./SvcService";

describe(ConfigurationService.name, () => {
  let context: TestEnvironment.Context;
  let service: ConfigurationService;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    service = new ConfigurationService(context.env, { streamSvcs: () => EMPTY } as unknown as SvcService, {} as SocketService);
  });

  it("should describe every setting with what was provided, and what applies otherwise", () => {
    // when
    const { settings } = service.snapshot([]);
    // then (instance-wide first, then the per-container ones, each under the operator's name for it)
    expect(settings.map(({ envVar }) => envVar)).toEqual([
      "DOLOG_TIMEZONE",
      "DOLOG_LOGGING",
      "DOLOG_DOCKER_SOCKET",
      "DOLOG_THROTTLING_LOGS_PER_SECOND",
      "DOLOG_RETENTION_TIME_WINDOW",
      "DOLOG_RETENTION_MAX_LINES",
    ]);
    expect(settings.find(({ envVar }) => envVar === "DOLOG_LOGGING")).toEqual({
      envVar: "DOLOG_LOGGING",
      envValue: "warn",
      defaultValue: "info",
    });
    expect(settings.find(({ envVar }) => envVar === "DOLOG_RETENTION_TIME_WINDOW")).toEqual({
      envVar: "DOLOG_RETENTION_TIME_WINDOW",
      envValue: "30d",
      defaultValue: "180d",
      containerLabel: { name: "dolog.retention.time-window", overrides: [] },
    });
  });

  it("should list every service overriding a setting, flagging unreadable values and stopped services", () => {
    // given
    const web = TestFixture.container({ dname: "web", dgroup: "shop", dlabels: { "throttling.logs-per-second": "50" } });
    const db = { ...TestFixture.container({ dname: "db", dlabels: { "throttling.logs-per-second": "abc" } }), dgroup: undefined };
    // when
    const { settings } = service.snapshot([svc(web, true), svc(db, false)]);
    // then
    const throttling = settings.find(({ envVar }) => envVar === "DOLOG_THROTTLING_LOGS_PER_SECOND");
    expect(throttling?.containerLabel?.overrides).toEqual([
      { dname: "web", dgroup: "shop", value: "50", valid: true, stopped: false },
      { dname: "db", dgroup: undefined, value: "abc", valid: false, stopped: true },
    ]);
    expect(settings.find(({ envVar }) => envVar === "DOLOG_RETENTION_MAX_LINES")?.containerLabel?.overrides).toEqual([]);
  });

  function svc({ dname, dgroup, dimage, dlabels }: Container, running: boolean): Svc {
    const liveStats = { throttling: false, logsPerSecond: 0, memoryTotal: 0, memoryUsage: 0, cpuTotal: 0, cpuUsage: 0 };
    return { id: Svc.encodeId({ dname, dgroup }), dname, dgroup, dimage, dlabels, liveStats: running ? liveStats : undefined };
  }
});
