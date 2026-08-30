import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { SocketService } from "@/services/SocketService";
import { Fountain } from "@/services/streaming/Fountain";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { TestFixture } from "@/testing/TestFixture.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { EMPTY } from "rxjs";
import { Container } from "@/models/Container";
import { Svc } from "@/models/Svc";
import { LogService } from "./LogService";

/** Reading is scoped to a service now, and a service is a name plus a group -- never the docker id */
const svcOf = ({ dname, dgroup }: Container): Svc.Id => ({ dname, dgroup });

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
    const all = [TestFixture.logEvent({ container, line: "older" }), TestFixture.logEvent({ container, line: "newer" })];
    all.forEach((event) => context.eventRepository.saveEvent(event));
    context.flushTrigger.next();
    await Bun.sleep(0);

    // when (exactly what the page sends on mount: a limit, a filter, no position)
    const page = await service.list(svcOf(container), { limit: "300", filterSince: "2020-01-01T00:00:00Z" });

    // then (the newest lines, and a window that reaches the feed)
    expect(page.data.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["older", "newer"]);
    expect(page.hasNewer).toBe(false);
  });

  describe("arriving by time", () => {
    /**
     * An `at` opens a window *around* itself rather than a page starting at it: half the limit from
     * before it, half from after, and a short side made up by the other. Where the instant fell among
     * those lines is not reported: it is derivable from the lines themselves, and only stays right
     * while they do -- the stream appends and paging replaces, so a figure fixed at request time
     * would go stale in the client's hands.
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

    it("should open on the first line at or after the instant when history lies ahead of it", async () => {
      const { container } = await twoLines();

      // when (an instant older than everything logged)
      const page = await service.list(svcOf(container), { at: "2020-01-01T00:00:00Z" });

      // then (nothing sits before it to fill the near half, so the window is all of what follows)
      expect(page.data.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""))).toEqual(["older", "newer"]);
      expect(page.hasOlder).toBe(false);
    });

    it("should serve the end of history when the instant lies past everything logged", async () => {
      const { container, all } = await twoLines();

      // when (an instant in the future, so reading forwards from it finds nothing)
      const page = await service.list(svcOf(container), { at: "2030-01-01T00:00:00Z" });

      // then (the tail of history, and nothing claimed to lie beyond it -- which is how the client
      // works out that the instant sits past every line it was given)
      expect(page.data.map((event) => event.id)).toEqual(all.map((event) => event.id));
      expect(page.hasNewer).toBe(false);
    });

    it("should describe the page it served, not the read it threw away", async () => {
      /**
       * The fallback discards a backwards read that said there was more ahead, and re-states
       * `hasNewer` as false to describe what it actually served. Whether the *feed* lies beyond
       * that is no longer asked here: it is the client's to work out from the filter's own bound.
       */
      const { container } = await twoLines();

      const open = await service.list(svcOf(container), { at: "2030-01-01T00:00:00Z" });
      expect(open.hasNewer).toBe(false);

      // and a corpus closed in the past runs out in exactly the same way
      const closed = await service.list(svcOf(container), { at: "2030-01-01T00:00:00Z", filterUntil: "2026-06-01T00:00:00Z" });
      expect(closed.hasNewer).toBe(false);
    });
  });

  describe("arriving at a line", () => {
    /** Ids are uuidv7s minted in order, so they sort the way the log reads. */
    async function lines(count: number) {
      const container = TestFixture.container();
      const all = Array.from({ length: count }, (_, index) => TestFixture.logEvent({ container, line: `line ${index}` }));
      all.forEach((event) => context.eventRepository.saveEvent(event));
      context.flushTrigger.next();
      await Bun.sleep(0);
      return { container, all };
    }

    const shown = (page: LogService.ListResult) =>
      page.data.map((event) => (event.type === ContainerEvent.Type.log ? event.line : ""));

    it("should open a window centred on the line, not a page starting at it", async () => {
      const { container, all } = await lines(40);

      // when (a line in the middle, with plenty either side of it)
      const page = await service.list(svcOf(container), { at: all[20]!.id, limit: "10" });

      // then (half the limit before it, and the line itself heading the other half)
      expect(shown(page)).toEqual(["line 15", "line 16", "line 17", "line 18", "line 19", "line 20", "line 21", "line 22", "line 23", "line 24"]);
      expect(page.hasOlder).toBe(true);
      expect(page.hasNewer).toBe(true);
    });

    it("should make up a short side from the other one, near the beginning", async () => {
      const { container, all } = await lines(40);

      // when (only two lines exist above it, so it cannot have its half)
      const page = await service.list(svcOf(container), { at: all[2]!.id, limit: "10" });

      // then (a full screen all the same, taken further forwards instead)
      expect(shown(page)).toEqual(["line 0", "line 1", "line 2", "line 3", "line 4", "line 5", "line 6", "line 7", "line 8", "line 9"]);
      expect(page.hasOlder).toBe(false);
      expect(page.hasNewer).toBe(true);
    });

    it("should make up a short side from the other one, near the end", async () => {
      const { container, all } = await lines(40);

      // when (only two lines from here to the end)
      const page = await service.list(svcOf(container), { at: all[38]!.id, limit: "10" });

      // then (the shortfall taken backwards, and the far edge reported honestly)
      expect(shown(page)).toEqual(["line 30", "line 31", "line 32", "line 33", "line 34", "line 35", "line 36", "line 37", "line 38", "line 39"]);
      expect(page.hasOlder).toBe(true);
      expect(page.hasNewer).toBe(false);
    });

    it("should land past a pinned line the filter excludes", async () => {
      const container = TestFixture.container();
      const all = Array.from({ length: 6 }, (_, index) =>
        TestFixture.logEvent({ container, line: index % 2 === 0 ? `keep ${index}` : `skip ${index}` }),
      );
      all.forEach((event) => context.eventRepository.saveEvent(event));
      context.flushTrigger.next();
      await Bun.sleep(0);

      // when (the pinned line is one the filter hides)
      const page = await service.list(svcOf(container), { at: all[3]!.id, limit: "10", filterPattern: "keep", filterPatternType: "substr" });

      // then (the window opens around where the pin would have been, made of lines the filter allows,
      // with the pin itself absent -- which is the client's answer too, since it marks a line by id
      // and finds none)
      expect(shown(page)).toEqual(["keep 0", "keep 2", "keep 4"]);
      expect(page.data.map((event) => event.id)).not.toContain(all[3]!.id);
    });
  });

  it("should still refuse an instant and a cursor together", async () => {
    const container = TestFixture.container();

    // then (two different answers to "where do I open", so neither is assumed)
    expect(
      service.list(svcOf(container), { at: "2026-01-01T00:00:00Z", beforeExclusive: "019fe10e-4a9f-700d-8f7c-f6ec636e67dc" }),
    ).rejects.toThrow(/conflicting_position/);
  });

  it("should refuse two forwards anchors at once", async () => {
    const container = TestFixture.container();

    // both read forwards, so sending them together says two different things about where to open.
    // Asked of the service rather than of `ListQuery`, because the rule is a refinement the service
    // adds -- the bare schema describes the shape of a query, not whether it makes sense.
    expect(
      service.list(svcOf(container), {
        afterExclusive: "019fe10e-4a9f-700d-8f7c-f6ec636e67dc",
        afterInclusive: "019fe10e-4ad6-7061-9172-2c3ecf40c00d",
      }),
    ).rejects.toThrow(/invalid_request_query/);
  });
});
