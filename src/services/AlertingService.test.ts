import { Env } from "@/Env";
import { Alert } from "@/models/Alert";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Svc } from "@/models/Svc";
import { Throughput } from "@/models/Throughput";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { NEVER, Observable } from "rxjs";
import { TestScheduler } from "rxjs/testing";
import { AlertingService } from "./AlertingService";
import { Fountain } from "./streaming/Fountain";
import { ThrottleService } from "./streaming/ThrottleService";
import { Route } from "@/website/Route";

/**
 * Cooldowns are time-based operators, so these run on rxjs' virtual clock: five minutes pass
 * instantly. What comes out is read off the sender, along with the virtual millisecond it arrived at.
 */
describe(AlertingService.name, () => {
  const ALERTING = { "alerting.webhook-ref": "ops", "alerting.text-pattern": "ERROR|FATAL", "alerting.throughput-threshold": "100" };

  let context: TestEnvironment.Context;
  let scheduler: TestScheduler;
  let sent: Array<{ at: number; alert: Alert }>;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    scheduler = new TestScheduler((actual, expected) => expect(actual).toEqual(expected));
    sent = [];
    context.webhookSenderMock.post.mockImplementation(async (_, alert) => void sent.push({ at: scheduler.now(), alert }));
  });

  describe("text", () => {
    it("should send an alert for a line matching the container's pattern", () => {
      // given
      const container = TestFixture.container({ dname: "web", dgroup: "shop", dlabels: ALERTING });
      const quiet = TestFixture.logEvent({ container, line: "GET / 200" });
      const loud = TestFixture.logEvent({ container, line: "FATAL out of memory" });

      scheduler.run(({ cold }) => {
        // when
        alertOn({ events: cold("ab", { a: quiet, b: loud }) });
      });
      // then
      expect(context.webhookSenderMock.post.mock.calls).toEqual([
        [
          context.env.DOLOG_WEBHOOKS.ops!,
          expect.objectContaining({
            object: "alert",
            type: Alert.Type.text,
            service: {
              id: Svc.encodeId({ dname: "web", dgroup: "shop" }),
              link: Route.svcsLogs(Svc.encodeId({ dname: "web", dgroup: "shop" })),
              dname: "web",
              dgroup: "shop",
            },
            containerEventId: loud.id,
            match: { pattern: "ERROR|FATAL", line: "FATAL out of memory" },
          } satisfies Partial<Alert.Text>),
        ],
      ]);
    });

    it("should stay silent without a webhook to tell, and for events that are not lines", () => {
      // given
      const nowhere = TestFixture.container({ dlabels: { "alerting.text-pattern": "ERROR" } });
      const somewhere = TestFixture.container({ dlabels: ALERTING });

      scheduler.run(({ cold }) => {
        // when
        alertOn({
          events: cold("ab", {
            a: TestFixture.logEvent({ container: nowhere, line: "ERROR boom" }),
            b: TestFixture.startEvent({ container: somewhere }),
          }),
        });
      });
      // then
      expect(sent).toBeEmpty();
    });

    it("should fall back on the environment for whatever the container leaves unlabelled", () => {
      // given (the pattern and webhook come from the env, the 30s cooldown from a label)
      const env = { ...context.env, DOLOG_ALERTING_WEBHOOK_REF: "ops", DOLOG_ALERTING_TEXT_PATTERN: /panic/ };
      const container = TestFixture.container({ dlabels: { "alerting.cooldown-window": "30s" } });
      const panic = TestFixture.logEvent({ container, line: "kernel panic" });

      scheduler.run(({ cold }) => {
        // when (at 0s, 29s and 31s)
        alertOn({ events: cold("a 28999ms a 1999ms a", { a: panic }), env });
      });
      // then
      expect(sent.map(({ at }) => at)).toEqual([0, 31_000]);
    });
  });

  describe("throughput", () => {
    it("should send an alert for a container writing more than its threshold", () => {
      // given (a threshold of 100)
      const container = TestFixture.container({ dname: "web", dgroup: "shop", dlabels: ALERTING });
      const unlabelled = TestFixture.container({ dname: "db" });

      scheduler.run(({ cold }) => {
        // when
        alertOn({
          throughputs: cold("ab", {
            a: [
              TestFixture.throughput({ container, logsPerSecond: 100 }),
              TestFixture.throughput({ container: unlabelled, logsPerSecond: 9000 }),
            ],
            b: [TestFixture.throughput({ container, logsPerSecond: 101 })],
          }),
        });
      });
      // then
      expect(sent).toEqual([
        {
          at: 1,
          alert: expect.objectContaining({
            type: Alert.Type.throughput,
            service: {
              id: Svc.encodeId({ dname: "web", dgroup: "shop" }),
              link: Route.svcsLogs(Svc.encodeId({ dname: "web", dgroup: "shop" })),
              dname: "web",
              dgroup: "shop",
            },
            breach: { threshold: 100, logsPerSecond: 101 },
          } satisfies Partial<Alert.Throughput>),
        },
      ]);
    });
  });

  describe("cooldown", () => {
    it("should let the first alert through and then stay quiet for the cooldown", () => {
      // given
      const container = TestFixture.container({ dlabels: { ...ALERTING, "alerting.cooldown-window": "1m" } });
      const error = TestFixture.logEvent({ container, line: "ERROR boom" });

      scheduler.run(({ cold }) => {
        // when (at 0s, 1s, 50s and 70s)
        alertOn({ events: cold("a 999ms a 48999ms a 19999ms a", { a: error }) });
      });
      // then
      expect(sent.map(({ at }) => at)).toEqual([0, 70_000]);
    });

    it("should cool down each service, and each type of alert, on its own", () => {
      // given
      const web = TestFixture.container({ dname: "web", dlabels: ALERTING });
      const db = TestFixture.container({ dname: "db", dlabels: ALERTING });

      scheduler.run(({ cold }) => {
        // when
        alertOn({
          events: cold("(ab) 996ms a", {
            a: TestFixture.logEvent({ container: web, line: "ERROR boom" }),
            b: TestFixture.logEvent({ container: db, line: "ERROR boom" }),
          }),
          throughputs: cold("a", { a: [TestFixture.throughput({ container: web, logsPerSecond: 250 })] }),
        });
      });
      // then
      expect(sent.map(({ at, alert }) => [at, alert.service.dname, alert.type])).toEqual([
        [0, "web", Alert.Type.text],
        [0, "db", Alert.Type.text],
        [0, "web", Alert.Type.throughput],
      ]);
    });

    it("should hold the cooldown across a restart, which is a new container of the same service", () => {
      // given
      const before = TestFixture.container({ dlabels: ALERTING });
      const after = TestFixture.container({ dlabels: ALERTING });

      scheduler.run(({ cold }) => {
        // when
        alertOn({
          events: cold("a 9999ms b", {
            a: TestFixture.logEvent({ container: before, line: "ERROR boom" }),
            b: TestFixture.logEvent({ container: after, line: "ERROR again" }),
          }),
        });
      });
      // then
      expect(sent.map(({ at }) => at)).toEqual([0]);
    });
  });

  describe("delivery", () => {
    it("should keep alerting after a webhook that does not exist, or one that fails", () => {
      // given
      context.webhookSenderMock.post.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      const nobody = TestFixture.container({ dname: "a", dlabels: { ...ALERTING, "alerting.webhook-ref": "nobody" } });
      const failing = TestFixture.container({ dname: "b", dlabels: ALERTING });
      const working = TestFixture.container({ dname: "c", dlabels: ALERTING });

      scheduler.run(({ cold }) => {
        // when
        alertOn({
          events: cold("abc", {
            a: TestFixture.logEvent({ container: nobody, line: "ERROR boom" }),
            b: TestFixture.logEvent({ container: failing, line: "ERROR boom" }),
            c: TestFixture.logEvent({ container: working, line: "ERROR boom" }),
          }),
        });
      });
      // then (the unknown webhook never reaches the sender at all)
      expect(context.webhookSenderMock.post.mock.calls.map(([, alert]) => alert.service.dname)).toEqual(["b", "c"]);
    });
  });

  function alertOn(sources: { events?: Observable<ContainerEvent>; throughputs?: Observable<Throughput[]>; env?: Env.Private }) {
    const fountain = { streamEvents: () => sources.events ?? NEVER } as unknown as Fountain;
    const throttleService = { streamThroughputs: () => sources.throughputs ?? NEVER } as unknown as ThrottleService;
    new AlertingService(fountain, throttleService, sources.env ?? context.env, context.webhookSenderMock.cast()).notifyWebhooksOfAlerts();
  }
});
