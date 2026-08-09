import { ContainerEvent } from "@/models/ContainerEvent";
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
