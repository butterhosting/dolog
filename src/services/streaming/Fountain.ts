import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Throughput } from "@/models/Throughput";
import { Temporal } from "@js-temporal/polyfill";
import { defer, EMPTY, filter, from, map, merge, mergeMap, Observable, of, repeat, retry, share, takeUntil, timer } from "rxjs";
import { DockerSocket } from "./DockerSocket";
import { ThrottleService } from "./ThrottleService";

/**
 * Our single (shared) source of continuous events
 *
 * Once this fountain is turned on, it emits for the lifetime of the process:
 * containers that come online start producing logs, containers that die stop, and a dead socket is
 * retried until it comes back.
 *
 * Log messages are throttled per container, see the {@link ThrottleService}
 */
export class Fountain {
  private readonly log = new Logger(__filename);
  private events?: Observable<ContainerEvent>;

  public constructor(
    private readonly dockerSocket: DockerSocket,
    private readonly throttleService: ThrottleService,
  ) {}

  public streamEvents(): Observable<ContainerEvent> {
    this.events ??= defer(() => this.rawSocketStream()) //
      .pipe(
        this.throttleService.groupAndThrottleByContainer(),
        share({
          // `resetOnRefCountZero: false` keeps the socket connections open even when no one is listening.
          // Without it, a momentary gap between subscribers would re-run the `defer`: every container
          // re-listed and re-attached, and both this class's and the throttler's state rebuilt.
          resetOnRefCountZero: false,
        }),
      );
    return this.events;
  }

  public streamThroughputs(): Observable<Throughput[]> {
    return this.throttleService.streamThroughputs();
  }

  private rawSocketStream(): Observable<ContainerEvent.Start | ContainerEvent.Stop | ContainerEvent.Log> {
    const containersBeingFollowed = new Set<string>();

    const lifecycle = this.lifecycle().pipe(share());

    const isStopped = (containerId: string): Observable<ContainerEvent.Stop> => {
      return lifecycle.pipe(
        filter((event) => event.container.id === containerId),
        filter((event): event is ContainerEvent.Stop => event.type === ContainerEvent.Type.stop),
      );
    };

    const followLogs = (container: Container): Observable<ContainerEvent.Log> => {
      if (containersBeingFollowed.has(container.id)) {
        return EMPTY;
      }
      containersBeingFollowed.add(container.id);
      return this.logs(container).pipe(takeUntil(isStopped(container.id)));
    };

    return merge(
      this.alreadyRunning().pipe(mergeMap(followLogs)),
      lifecycle.pipe(
        mergeMap((event) => {
          switch (event.type) {
            case ContainerEvent.Type.start: {
              return merge(of(event), followLogs(event.container));
            }
            case ContainerEvent.Type.stop: {
              containersBeingFollowed.delete(event.container.id);
              console.log(`Server STOP; ${event.id}; ${JSON.stringify(event.container, null, 2)}`);
              return of(event);
            }
          }
        }),
      ),
    );
  }

  private alreadyRunning(): Observable<Container> {
    return defer(() => this.dockerSocket.listRunningContainers()).pipe(
      retry({
        delay: (error, retryCount) => this.exponentialBackoff(retryCount, "Could not list running containers", error),
        resetOnSuccess: true,
      }),
      mergeMap((containers) => from(containers)),
    );
  }

  private lifecycle(): Observable<ContainerEvent.Start | ContainerEvent.Stop> {
    return this.toObservable((signal) => this.dockerSocket.streamLifecycles(signal)) //
      .pipe(
        map(({ status, timestamp, container }): ContainerEvent.Start | ContainerEvent.Stop => {
          return status === "start"
            ? {
                type: ContainerEvent.Type.start,
                object: "container_event",
                id: Bun.randomUUIDv7(),
                timestamp,
                container,
              }
            : {
                type: ContainerEvent.Type.stop,
                object: "container_event",
                id: Bun.randomUUIDv7(),
                timestamp,
                container,
              };
        }),
        retry({
          // retry indefinitely when the stream closes with an error
          delay: (error, retryCount) => this.exponentialBackoff(retryCount, "Docker event stream failed", error),
          resetOnSuccess: true,
        }),
        repeat({
          // retry indefinitely when the stream closes cleanly
          delay: (retryCount) => this.exponentialBackoff(retryCount, "Docker event stream closed"),
        }),
      );
  }

  private logs(container: Container): Observable<ContainerEvent.Log> {
    return this.toObservable((signal) => this.dockerSocket.streamLogLines(container.id, signal)) //
      .pipe(
        map(({ streamVariant, timestamp, line }): ContainerEvent.Log => ({
          object: "container_event",
          id: Bun.randomUUIDv7(),
          type: ContainerEvent.Type.log,
          timestamp,
          container,
          streamVariant,
          line,
        })),
        retry({
          // retry indefinitely when the stream closes with an error
          delay: (error, retryCount) => this.exponentialBackoff(retryCount, `Log stream failed for ${container.name}`, error),
          resetOnSuccess: true, // a stream that ran fine for hours starts its next trouble from scratch
        }),
        repeat({
          // retry indefinitely when the stream closes cleanly
          delay: (retryCount) => this.exponentialBackoff(retryCount, `Log stream closed for ${container.name}`),
        }),
      );
  }

  /**
   * `retryCount` = 1,2,3,4,5,...
   */
  private exponentialBackoff(retryCount: number, message: string, error?: unknown): Observable<unknown> {
    const min = Temporal.Duration.from({ milliseconds: 100 });
    const max = Temporal.Duration.from({ seconds: 2 });

    // 100ms -> 200ms -> 400ms -> 800ms -> 1600ms -> 2000ms ....
    const delay = Math.min(max.total("milliseconds"), min.total("milliseconds") * Math.pow(2, retryCount - 1));

    const logMessage = `${message}, retrying in ${delay}ms (#${retryCount})`;
    if (error) {
      this.log.warn(logMessage, error);
    } else {
      this.log.debug(logMessage);
    }
    return timer(delay);
  }

  /**
   * Bridges an async generator into an Observable, wiring unsubscription to an AbortSignal so that
   * tearing down the stream also closes the underlying HTTP request to the socket.
   */
  private toObservable<T>(generate: (signal: AbortSignal) => AsyncGenerator<T>): Observable<T> {
    return new Observable<T>((subscriber) => {
      const controller = new AbortController();
      void (async () => {
        try {
          for await (const value of generate(controller.signal)) {
            subscriber.next(value);
          }
          subscriber.complete();
        } catch (error) {
          if (!controller.signal.aborted) {
            subscriber.error(error);
          }
        }
      })();
      return () => controller.abort();
    });
  }
}
