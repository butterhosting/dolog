import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { catchError, defer, EMPTY, from, map, merge, mergeMap, Observable, of, repeat, retry, share, timer } from "rxjs";
import { DockerSocket } from "./DockerSocket";

const RECONNECT_DELAY_MS = 2_000;

/**
 * The single source of container events. Turned on once, it emits for the lifetime of the process:
 * containers that come online start producing logs, containers that die stop, and a dead socket is
 * retried until it comes back.
 *
 * The stream reports only what actually happened while it was listening. Containers that were
 * already up get their logs followed but no `start` -- dolog did not witness them start, and
 * inventing one would date it to boot time rather than to the event. Ask `DockerSocket` directly
 * for a point-in-time view of what is running.
 *
 * It never emits `throttle` events -- that is the throttler's job, downstream.
 */
export class DockerFountain {
  private readonly log = new Logger(__filename);
  private events?: Observable<ContainerEvent>;

  public constructor(private readonly dockerSocket: DockerSocket) {}

  public initialize(): Observable<ContainerEvent> {
    this.events ??= defer(() => this.beginListening()).pipe(share({ resetOnRefCountZero: false }));
    return this.events;
  }

  private beginListening(): Observable<ContainerEvent> {
    const streaming = new Set<string>();
    /**
     * The listing and the event stream are opened concurrently, so a container starting in that
     * window shows up in both. Attaching twice would duplicate every one of its log lines.
     */
    const follow = (container: Container): Observable<ContainerEvent.Log> => {
      if (streaming.has(container.id)) {
        return EMPTY;
      }
      streaming.add(container.id);
      return this.logs(container);
    };
    return merge(
      this.alreadyRunning().pipe(mergeMap(follow)),
      this.lifecycle().pipe(
        mergeMap((event) => {
          if (event.type === ContainerEvent.Type.stop) {
            streaming.delete(event.container.id);
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
    return this.abortable((signal) => this.dockerSocket.streamLifecycle(signal)).pipe(
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
    return this.abortable((signal) => this.dockerSocket.streamLogs(container.id, signal)).pipe(
      map(({ stdStream, timestamp, message }): ContainerEvent.Log => ({
        object: "container_event",
        type: ContainerEvent.Type.log as const,
        timestamp,
        container,
        stdStream,
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
