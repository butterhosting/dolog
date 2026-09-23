import { $container, $containerEvent } from "@/drizzle/schema";
import { Env } from "@/Env";
import { ServerError } from "@/errors/ServerError";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { RestrictedService } from "./RestrictedService";

describe(RestrictedService.name, () => {
  let context: TestEnvironment.Context;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
  });

  const serviceFor = (stage: Env.Private["DOLOG_STAGE"]) => new RestrictedService({ ...context.env, DOLOG_STAGE: stage }, context.sqlite);

  const saveSomeEvents = async () => {
    const container = TestFixture.container();
    [TestFixture.startEvent({ container }), TestFixture.logEvent({ container, line: "remember me" })].forEach((event) =>
      context.eventRepository.saveEvent(event),
    );
    context.flushTrigger.next();
    await Bun.sleep(0);
  };

  const countEvents = () => context.sqlite.select().from($containerEvent).all().length;
  const countContainers = () => context.sqlite.select().from($container).all().length;

  describe("purge", () => {
    for (const stage of ["dev", "e2e"] as const) {
      it(`should forget every event but keep the containers in ${stage}`, async () => {
        // given
        await saveSomeEvents();
        expect(countEvents()).toBe(2);

        // when
        await serviceFor(stage).purge();

        // then
        expect(countEvents()).toBe(0);
        expect(countContainers()).toBe(1);
      });
    }

    it("should refuse in production", async () => {
      // given
      await saveSomeEvents();

      // when
      const purging = serviceFor("prod").purge();

      // then
      await expect(purging).rejects.toThrow(ServerError.route_not_found().message);
      expect(countEvents()).toBe(2);
    });
  });
});
