import { $container, $containerEvent } from "@/drizzle/schema";
import { Env } from "@/Env";
import { ServerError } from "@/errors/ServerError";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
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
      it(`should leave the containers and the fixture's history behind in ${stage}, and no other event`, async () => {
        // given
        await saveSomeEvents();
        expect(countEvents()).toBe(2);

        // when
        await serviceFor(stage).purge();

        // then
        const events = context.sqlite.select().from($containerEvent).all();
        const fixture = context.sqlite.select().from($container).where(eq($container.dname, "fixture")).all().at(0)!;
        expect(events.length).toBeGreaterThan(0);
        expect(events.every((event) => event.containerId === fixture.id)).toBe(true);
        // the one the events belonged to, and the fixture
        expect(countContainers()).toBe(2);
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
