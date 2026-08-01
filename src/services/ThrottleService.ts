import { Env } from "@/Env";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { DologEvent } from "@/models/DologEvent";
import { ThrottleEvent } from "@/models/ThrottleEvent";
import { Throughput } from "@/models/Throughput";
import { Temporal } from "@js-temporal/polyfill";
import { Buffer } from "buffer";
import {
  debounceTime,
  EMPTY,
  finalize,
  groupBy,
  GroupedObservable,
  interval,
  merge,
  mergeMap,
  Observable,
  of,
  Subject,
  takeUntil,
} from "rxjs";

const WINDOW_MS = 1_000;
const IDLE_EVICTION_MS = 5 * 60 * 1_000;

export class ThrottleService {
  private readonly throughput = new Map<string, Throughput>();

  public constructor(private readonly env: Env.Private) {}

  public throttle(events: Observable<ContainerEvent>): Observable<DologEvent> {
    return events.pipe(
      groupBy((event) => event.container.id, {
        duration: (group) => group.pipe(debounceTime(IDLE_EVICTION_MS)),
      }),
      mergeMap((group) => this.throttleContainer(group)),
    );
  }

  public dashboard(): Throughput[] {
    return [...this.throughput.values()];
  }

  /**
   * Logs pass through untouched until the per-window budget is spent; everything after that is
   * discarded and reported as a single `throttle` event when the window closes. Well-behaved
   * containers therefore see no added latency at all.
   */
  private throttleContainer(group: GroupedObservable<string, ContainerEvent>): Observable<DologEvent> {
    const limit = this.env.X_DOLOG_THROTTLE_LOGS_PER_SECOND;
    const closed = new Subject<void>();
    const window = { container: undefined as Container | undefined, logs: 0, bytes: 0, folded: 0 };

    const passed = group.pipe(
      mergeMap((event) => {
        window.container = event.container;
        if (event.type !== ContainerEvent.Type.log) {
          return of(event);
        }
        window.logs += 1;
        window.bytes += Buffer.byteLength(event.message);
        if (window.logs > limit) {
          window.folded += 1;
          return EMPTY;
        }
        return of(event);
      }),
      finalize(() => {
        closed.next();
        closed.complete();
      }),
    );

    const windows: Observable<ThrottleEvent> = interval(WINDOW_MS).pipe(
      takeUntil(closed),
      mergeMap(() => {
        const { container, logs, bytes, folded } = window;
        window.logs = 0;
        window.bytes = 0;
        window.folded = 0;
        if (!container) {
          return EMPTY;
        }
        const measured = Temporal.Now.instant();
        this.throughput.set(container.id, {
          object: "throughput",
          container,
          logsPerSecond: logs,
          bytesPerSecond: bytes,
          foldedPerSecond: folded,
          measured,
        });
        if (folded === 0) {
          return EMPTY;
        }
        return of<ThrottleEvent>({
          object: "throttle_event",
          timestamp: measured,
          container,
          foldCount: folded,
        });
      }),
    );

    return merge(passed, windows).pipe(
      finalize(() => {
        if (window.container) {
          this.throughput.delete(window.container.id);
        }
      }),
    );
  }
}
