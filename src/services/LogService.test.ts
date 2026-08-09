import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { SocketService } from "@/services/SocketService";
import { Fountain } from "@/services/streaming/Fountain";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { EMPTY } from "rxjs";
import { LogService } from "./LogService";

describe(LogService.name, () => {
  let context: TestEnvironment.Context;
  let service: LogService;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    // `list` reaches only the repository; the stream is the constructor's business, not this one's
    const fountain = { streamEvents: () => EMPTY } as unknown as Fountain;
    service = new LogService(fountain, context.eventRepository, {} as SocketService);
  });

  it("should read the live end when asked for no position at all", async () => {
    /**
     * How a page opens with nothing in its url, and how it rejoins the stream after being away.
     * Refusing it used to leave the reader with an empty window and no history: the request the
     * frontend makes on mount carries a filter and a limit, and no cursor whatsoever.
     */
    const container = TestFixture.container();
    const all = [
      TestFixture.logEvent({ container, line: "older" }),
      TestFixture.logEvent({ container, line: "newer" }),
    ];
    all.forEach((event) => context.eventRepository.saveEvent(event));
    context.flushTrigger.next();
    await Bun.sleep(0);

    // when (exactly what the page sends on mount: a limit, a filter, no position)
    const page = await service.list(container.id, { limit: "300", filterSince: "2020-01-01T00:00:00Z" });

    // then (the newest lines, and a window that reaches the feed)
    expect(page.events.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["older", "newer"]);
    expect(page.hasNewer).toBe(false);
  });

  describe("arriving by time", () => {
    /**
     * An `at` is resolved rather than passed on: the service reads forwards from the instant, and
     * falls back to the end of history when nothing lies beyond it. Which of the two happened is
     * reported as `landedOn`, so the client is never left to work it out from the page itself.
     */
    async function twoLines() {
      const container = TestFixture.container();
      const all = [
        TestFixture.logEvent({ container, line: "older", timestamp: Temporal.Instant.from("2026-01-01T00:00:00Z") }),
        TestFixture.logEvent({ container, line: "newer", timestamp: Temporal.Instant.from("2026-01-02T00:00:00Z") }),
      ];
      all.forEach((event) => context.eventRepository.saveEvent(event));
      context.flushTrigger.next();
      await Bun.sleep(0);
      return { container, all };
    }

    it("should report the line it landed on when the instant has history ahead of it", async () => {
      const { container } = await twoLines();

      // when (an instant older than everything logged)
      const page = await service.list(container.id, { at: "2020-01-01T00:00:00Z" });

      // then (it opened on the first line at or after the instant, and says which that was)
      expect(page.landedOn).toBe(page.events[0]!.id);
      expect(page.events.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["older", "newer"]);
    });

    it("should serve the end of history when the instant lies past everything logged", async () => {
      const { container, all } = await twoLines();

      // when (an instant in the future, so reading forwards from it finds nothing)
      const page = await service.list(container.id, { at: "2030-01-01T00:00:00Z" });

      // then (`landedOn` is null precisely because it did not land where it was asked)
      expect(page.landedOn).toBeNull();
      expect(page.events.map((event) => event.id)).toEqual(all.map((event) => event.id));
      expect(page.hasNewer).toBe(false);
    });

    it("should describe the feed by the page it served, not by the read it threw away", async () => {
      /**
       * The fallback re-states `hasNewer` as false, having discarded a backwards read that said
       * otherwise. `reachesLiveFeed` is derived from that same answer, so it has to be re-stated
       * with it -- left alone, it would still be describing the read that was abandoned.
       */
      const { container } = await twoLines();

      const open = await service.list(container.id, { at: "2030-01-01T00:00:00Z" });
      expect(open.reachesLiveFeed).toBe(true);

      // and a window closed in the past reaches its own end without reaching the feed
      const closed = await service.list(container.id, { at: "2030-01-01T00:00:00Z", filterUntil: "2026-06-01T00:00:00Z" });
      expect(closed.reachesLiveFeed).toBe(false);
    });
  });

  it("should still refuse an instant and a cursor together", async () => {
    const container = TestFixture.container();

    // then (two different answers to "where do I open", so neither is assumed)
    expect(
      service.list(container.id, { at: "2026-01-01T00:00:00Z", beforeExclusive: "019fe10e-4a9f-700d-8f7c-f6ec636e67dc" }),
    ).rejects.toThrow(/conflicting_position/);
  });

  it("should refuse two forwards anchors at once", () => {
    // both read forwards, so sending them together says two different things about where to open
    expect(() =>
      LogService.ListQuery.parse({
        afterExclusive: "019fe10e-4a9f-700d-8f7c-f6ec636e67dc",
        afterInclusive: "019fe10e-4ad6-7061-9172-2c3ecf40c00d",
      }),
    ).toThrow(/invalid_request_query/);
  });
});
