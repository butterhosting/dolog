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
    const IDLE_EVICTION = Temporal.Duration.from({ minutes: 1 });

    return pipe(
      groupBy((event: ContainerEvent.Start | ContainerEvent.Stop | ContainerEvent.Log) => event.container.did, {
        // we set a `duration`, otherwise every container creates its own group
        // and every created group stays alive forever ... thats a bit expensive
        // because each group has a periodic timer for calculating throughputs,
        // so if we dont clean up container groups after some time, we'll forever
        // accumulate periodic timers for each container, including all historic ones
        duration: (group) => group.pipe(debounceTime(IDLE_EVICTION.total("milliseconds"))),
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
    const WINDOW = Temporal.Duration.from({ seconds: 1 });

    const signalToStopWatchingThisContainer = new Subject<void>();

    const windowBudget = {
      container: undefined as Container | undefined,
      logs: 0,
      bytes: 0,
      droppedLogs: 0,
    };

    const allowedContainerEvents: Observable<ContainerEvent.Start | ContainerEvent.Stop | ContainerEvent.Log> = group.pipe(
      mergeMap((event) => {
        windowBudget.container = event.container;
        switch (event.type) {
          case ContainerEvent.Type.start:
          case ContainerEvent.Type.stop: {
            return of(event);
          }
          case ContainerEvent.Type.log: {
            windowBudget.logs += 1;
            windowBudget.bytes += Buffer.byteLength(event.line);
            if (windowBudget.logs > RATE_LIMIT) {
              windowBudget.droppedLogs += 1;
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

    const throttleEvents: Observable<ContainerEvent.LogThrottle> = interval(WINDOW.total("milliseconds")).pipe(
      takeUntil(signalToStopWatchingThisContainer),
      mergeMap(() => {
        const { container, logs, bytes, droppedLogs } = windowBudget;
        windowBudget.logs = 0;
        windowBudget.bytes = 0;
        windowBudget.droppedLogs = 0;
        if (!container) {
          return EMPTY;
        }

        const now = Temporal.Now.instant();
        this.throughputOverview.set(container.did, {
          object: "throughput",
          container,
          throttling: droppedLogs > 0,
          logsPerSecond: logs,
          bytesPerSecond: bytes,
        });
        this.throughputs.next([...this.throughputOverview.values()]);
        if (droppedLogs === 0) {
          return EMPTY;
        }

        return of<ContainerEvent.LogThrottle>({
          object: "container_event",
          id: Bun.randomUUIDv7(),
          type: ContainerEvent.Type.log_throttle,
          timestamp: now,
          container,
          dropCount: droppedLogs,
        });
      }),
      /**
       * This observable owns the container's throughput entry -- it is the only thing that writes
       * one, so it is also what removes it. It ends when the container's events do, via the
       * `takeUntil` above.
       */
      finalize(() => {
        if (windowBudget.container) {
          this.throughputOverview.delete(windowBudget.container.did);
          this.throughputs.next([...this.throughputOverview.values()]);
        }
      }),
    );

    return merge(allowedContainerEvents, throttleEvents);
  }
}
