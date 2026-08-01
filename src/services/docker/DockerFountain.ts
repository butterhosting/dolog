import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import { catchError, defer, EMPTY, from, map, merge, mergeMap, Observable, of, repeat, retry, share, timer } from "rxjs";
import { DockerSocket } from "./DockerSocket";

const RECONNECT_DELAY_MS = 2_000;

/**
 * The single source of container events. Turned on once, it emits for the lifetime of the process:
 * containers that come online start producing logs, containers that die stop, and a dead socket is
 * retried until it comes back.
 *
 * It never emits `throttle` events -- that is the throttler's job, downstream.
 */
export class DockerFountain {
  private readonly log = new Logger(__filename);
  private events?: Observable<ContainerEvent>;

  public constructor(private readonly dockerSocket: DockerSocket) {}

  public initialize(): Observable<ContainerEvent> {
    /**
     * Memoized and kept hot: subscribing twice must not open a second set of log streams, and the
     * fountain must not shut down when the last subscriber happens to drop off.
     */
    this.events ??= defer(() => this.produce()).pipe(share({ resetOnRefCountZero: false }));
    return this.events;
  }

  private produce(): Observable<ContainerEvent> {
    const streaming = new Set<string>();
    return merge(this.alreadyRunning(), this.lifecycle()).pipe(
      mergeMap((event) => {
        if (event.type === ContainerEvent.Type.stop) {
          streaming.delete(event.container.id);
          return of(event);
        }
        /**
         * A container that was already up when we started also produces a `start` event if it was
         * started moments ago, so the same container can arrive twice. Attaching twice would
         * duplicate every one of its log lines.
         */
        if (streaming.has(event.container.id)) {
          return EMPTY;
        }
        streaming.add(event.container.id);
        return merge(of(event), this.logs(event.container));
      }),
    );
  }

  /**
   * Containers that were already running get a synthetic `start`, so that a restart of dolog
   * presents the same picture as having watched them boot.
   */
  private alreadyRunning(): Observable<ContainerEvent.Start> {
    return defer(() => this.dockerSocket.listRunningContainers()).pipe(
      retry({ delay: (error) => this.reconnect("Could not list running containers", error) }),
      mergeMap((containers) => from(containers)),
      map((container) => ({
        type: ContainerEvent.Type.start as const,
        timestamp: Temporal.Now.instant(),
        container,
      })),
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
          ? { type: ContainerEvent.Type.start, timestamp, container }
          : { type: ContainerEvent.Type.stop, timestamp, container };
      }),
      retry({ delay: (error) => this.reconnect("Docker event stream failed", error) }),
      repeat({ delay: () => this.reconnect("Docker event stream closed") }),
    );
  }

  /**
   * One container's logs failing must not take the fountain down with it.
   */
  private logs(container: Container): Observable<ContainerEvent.Log> {
    return defer(() => this.dockerSocket.hasTty(container.id)).pipe(
      mergeMap((tty) => this.abortable((signal) => this.dockerSocket.streamLogs(container.id, tty, signal))),
      map(({ stream, timestamp, message }) => ({
        type: ContainerEvent.Type.log as const,
        timestamp,
        container,
        stream,
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
