import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { catchError, defer, EMPTY, from, map, merge, mergeMap, Observable, of, repeat, retry, share, timer } from "rxjs";
import { DockerSocket } from "./DockerSocket";
import { ThrottleService } from "./ThrottleService";
import { DologEvent } from "@/models/DologEvent";
import { Throughput } from "@/models/Throughput";

const RECONNECT_DELAY_MS = 2_000;

/**
 * Our single source of continuous events.
 *
 * Once this fountain is turned on, it emits for the lifetime of the process:
 * containers that come online start producing logs, containers that die stop, and a dead socket is
 * retried until it comes back.
 *
 * Log messages are throttled per container, see the {@link ThrottleService}
 */
export class FountainService {
  private readonly log = new Logger(__filename);
  private stream?: Observable<DologEvent>;

  public constructor(
    private readonly dockerSocket: DockerSocket,
    private readonly throttleService: ThrottleService,
  ) {}

  public activate(): Observable<DologEvent> {
    this.stream ??= defer(() => this.rawSocketStream()).pipe(
      this.throttleService.groupAndThrottleByContainer(),
      share({
        // `resetOnRefCountZero: false` keeps the socket connections open even when no one is listening.
        // Without it, a momentary gap between subscribers would re-run the `defer`: every container
        // re-listed and re-attached, and both this class's and the throttler's state rebuilt.
        resetOnRefCountZero: false,
      }),
    );
    return this.stream;
  }

  public throughputs(): Observable<Throughput[]> {
    return this.throttleService.throughputs();
  }

  private rawSocketStream(): Observable<ContainerEvent> {
    const containersBeingFollowed = new Set<string>();
    /**
     * The listing and the event stream are opened concurrently, so a container starting in that
     * window shows up in both. Attaching twice would duplicate every one of its log lines.
     */
    const follow = (container: Container): Observable<ContainerEvent.Log> => {
      if (containersBeingFollowed.has(container.id)) {
        return EMPTY;
      }
      containersBeingFollowed.add(container.id);
      return this.logs(container);
    };
    return merge(
      this.alreadyRunning().pipe(mergeMap(follow)),
      this.lifecycle().pipe(
        mergeMap((event) => {
          if (event.type === ContainerEvent.Type.stop) {
            containersBeingFollowed.delete(event.container.id);
            return of(event);
          }
          return merge(of(event), follow(event.container));
        }),
      ),
    );
  }

  /**
   * Docker's event stream only reports from the moment it is opened, so without this the fountain
   * would stay silent until something happened to restart. These containers are followed for their
   * logs only -- they produce no event of their own.
   */
  private alreadyRunning(): Observable<Container> {
    return defer(() => this.dockerSocket.listRunningContainers()).pipe(
      retry({ delay: (error) => this.reconnect("Could not list running containers", error) }),
      mergeMap((containers) => from(containers)),
    );
  }

  /**
   * `retry` covers a socket that errors out, `repeat` covers one that closes cleanly; between them
   * this observable never terminates, which is what keeps the fountain running.
   */
  private lifecycle(): Observable<ContainerEvent.Start | ContainerEvent.Stop> {
    return this.abortable((signal) => this.dockerSocket.streamLifecycles(signal)).pipe(
      map(({ status, timestamp, container }): ContainerEvent.Start | ContainerEvent.Stop => {
        return status === "start"
          ? {
              type: ContainerEvent.Type.start,
              object: "container_event",
              timestamp,
              container,
            }
          : {
              type: ContainerEvent.Type.stop,
              object: "container_event",
              timestamp,
              container,
            };
      }),
      retry({ delay: (error) => this.reconnect("Docker event stream failed", error) }),
      repeat({ delay: () => this.reconnect("Docker event stream closed") }),
    );
  }

  /**
   * One container's logs failing must not take the fountain down with it.
   */
  private logs(container: Container): Observable<ContainerEvent.Log> {
    return this.abortable((signal) => this.dockerSocket.streamLogLines(container.id, signal)).pipe(
      map(({ streamVariant, timestamp, message }): ContainerEvent.Log => ({
        object: "container_event",
        type: ContainerEvent.Type.log as const,
        timestamp,
        container,
        streamVariant,
        message,
      })),
      catchError((error) => {
        this.log.warn(`Stopped following logs for ${container.name}`, error);
        return EMPTY;
      }),
    );
  }

  private reconnect(message: string, error?: unknown): Observable<unknown> {
    this.log.warn(`${message}, retrying in ${RECONNECT_DELAY_MS}ms`, error ?? "");
    return timer(RECONNECT_DELAY_MS);
  }

  /**
   * Bridges an async generator into an Observable, wiring unsubscription to an AbortSignal so that
   * tearing down the stream also closes the underlying HTTP request to the socket.
   */
  private abortable<T>(generate: (signal: AbortSignal) => AsyncGenerator<T>): Observable<T> {
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
