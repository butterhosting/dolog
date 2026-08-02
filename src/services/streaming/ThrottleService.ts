import { Env } from "@/Env";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Throughput } from "@/models/Throughput";
import { Temporal } from "@js-temporal/polyfill";
import { Buffer } from "buffer";
import {
  BehaviorSubject,
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
  private readonly throughputs = new BehaviorSubject<Throughput[]>([]);
  private readonly throughputOverview = new Map<string, Throughput>();

  public constructor(private readonly env: Env.Private) {}

  public streamThroughputs(): Observable<Throughput[]> {
    return this.throughputs;
  }

  /**
   * Transforms an Observable<ContainerEvent> into a (throttled) Observable<DologEvent>
   */
  public groupAndThrottleByContainer() {
    const IDLE_EVICTION_MS = 60 * 1_000;

    return pipe(
      groupBy((event: ContainerEvent.Start | ContainerEvent.Stop | ContainerEvent.Log) => event.container.id, {
        // we set a `duration`, otherwise every container creates its own group
        // and every created group stays alive forever ... thats a bit expensive
        // because each group has a periodic timer for calculating throughputs,
        // so if we dont clean up container groups after some time, we'll forever
        // accumulate periodic timers for each container, including all historic ones
        duration: (group) => group.pipe(debounceTime(IDLE_EVICTION_MS)),
      }),
      mergeMap((group) => this.throttleContainer(group)),
    );
  }

  /**
   * Logs pass through untouched until the per-window budget is spent; everything after that is
   * discarded and reported as a single `throttle` event when the window closes. Well-behaved
   * containers therefore see no added latency at all.
   */
  private throttleContainer(
    group: GroupedObservable<string, ContainerEvent.Start | ContainerEvent.Stop | ContainerEvent.Log>,
  ): Observable<ContainerEvent> {
    const RATE_LIMIT = this.env.X_DOLOG_THROTTLE_LOGS_PER_SECOND;
    const WINDOW_MS = 1_000;

    const signalToStopWatchingThisContainer = new Subject<void>();

    const window = {
      container: undefined as Container | undefined,
      logs: 0,
      bytes: 0,
      folded: 0,
    };

    const allowedContainerEvents: Observable<ContainerEvent.Start | ContainerEvent.Stop | ContainerEvent.Log> = group.pipe(
      mergeMap((event) => {
        window.container = event.container;
        switch (event.type) {
          case ContainerEvent.Type.start:
          case ContainerEvent.Type.stop: {
            return of(event);
          }
          case ContainerEvent.Type.log: {
            window.logs += 1;
            window.bytes += Buffer.byteLength(event.line);
            if (window.logs > RATE_LIMIT) {
              window.folded += 1;
              return EMPTY;
            }
            return of(event);
          }
        }
      }),
      finalize(() => {
        signalToStopWatchingThisContainer.next();
        signalToStopWatchingThisContainer.complete();
      }),
    );

    const throttleEvents: Observable<ContainerEvent.LogThrottle> = interval(WINDOW_MS).pipe(
      takeUntil(signalToStopWatchingThisContainer),
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
        this.throughputs.next([...this.throughputOverview.values()]);
        if (folded === 0) {
          return EMPTY;
        }

        return of<ContainerEvent.LogThrottle>({
          object: "container_event",
          type: ContainerEvent.Type.log_throttle,
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
          this.throughputs.next([...this.throughputOverview.values()]);
        }
      }),
    );

    return merge(allowedContainerEvents, throttleEvents);
  }
}
