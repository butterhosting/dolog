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
  pipe,
  Subject,
  takeUntil,
} from "rxjs";

export class ThrottleService {
  private readonly throughputOverview = new Map<string, Throughput>();
  private readonly throughputOverviewSubject = new Subject<Throughput[]>();

  private readonly WINDOW_MS: number;
  private readonly IDLE_EVICTION_MS: number;

  public constructor(private readonly env: Env.Private) {
    this.WINDOW_MS = 1_000;
    this.IDLE_EVICTION_MS = 60 * 1_000;
  }

  public throughputs(): Observable<Throughput[]> {
    return this.throughputOverviewSubject;
  }

  /**
   * Transforms an Observable<ContainerEvent> into a (throttled) Observable<DologEvent>
   */
  public groupAndThrottleByContainer() {
    return pipe(
      groupBy((event: ContainerEvent) => event.container.id, {
        // we set a `duration`, otherwise every container creates its own group
        // and every created group stays alive forever ... thats a bit expensive
        // because each group has a periodic timer for calculating throughputs,
        // so if we dont clean up container groups after some time, we'll forever
        // accumulate periodic timers for each container, including all historic ones
        duration: (group) => group.pipe(debounceTime(this.IDLE_EVICTION_MS)),
      }),
      mergeMap((group) => this.throttleContainer(group)),
    );
  }

  /**
   * Logs pass through untouched until the per-window budget is spent; everything after that is
   * discarded and reported as a single `throttle` event when the window closes. Well-behaved
   * containers therefore see no added latency at all.
   */
  private throttleContainer(group: GroupedObservable<string, ContainerEvent>): Observable<DologEvent> {
    const rateLimit = this.env.X_DOLOG_THROTTLE_LOGS_PER_SECOND;
    const stopWatchingThisContainer = new Subject<void>();

    const window = {
      container: undefined as Container | undefined,
      logs: 0,
      bytes: 0,
      folded: 0,
    };

    const allowedEvents: Observable<ContainerEvent> = group.pipe(
      mergeMap((event) => {
        window.container = event.container;
        switch (event.type) {
          case ContainerEvent.Type.start:
          case ContainerEvent.Type.stop: {
            return of(event);
          }
          case ContainerEvent.Type.log: {
            window.logs += 1;
            window.bytes += Buffer.byteLength(event.message);
            if (window.logs > rateLimit) {
              window.folded += 1;
              return EMPTY;
            }
            return of(event);
          }
        }
      }),
      finalize(() => {
        stopWatchingThisContainer.next();
        stopWatchingThisContainer.complete();
      }),
    );

    const throttleEvents: Observable<ThrottleEvent> = interval(this.WINDOW_MS).pipe(
      takeUntil(stopWatchingThisContainer),
      mergeMap(() => {
        const { container, logs, bytes, folded } = window;
        window.logs = 0;
        window.bytes = 0;
        window.folded = 0;
        if (!container) {
          return EMPTY;
        }

        const now = Temporal.Now.instant();
        this.throughputOverview.set(container.id, {
          object: "throughput",
          container,
          throttling: folded > 0,
          logsPerSecond: logs,
          bytesPerSecond: bytes,
          timestamp: now,
        });
        this.throughputOverviewSubject.next([...this.throughputOverview.values()]);
        if (folded === 0) {
          return EMPTY;
        }

        return of<ThrottleEvent>({
          object: "throttle_event",
          timestamp: now,
          container,
          foldCount: folded,
        });
      }),
      /**
       * This observable owns the container's throughput entry -- it is the only thing that writes
       * one, so it is also what removes it. It ends when the container's events do, via the
       * `takeUntil` above.
       */
      finalize(() => {
        if (window.container) {
          this.throughputOverview.delete(window.container.id);
          this.throughputOverviewSubject.next([...this.throughputOverview.values()]);
        }
      }),
    );

    return merge(allowedEvents, throttleEvents);
  }
}
