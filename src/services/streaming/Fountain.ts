import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { LiveStats } from "@/models/LiveStats";
import { Temporal } from "@js-temporal/polyfill";
import {
  defer,
  EMPTY,
  exhaustMap,
  filter,
  from,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  repeat,
  ReplaySubject,
  retry,
  share,
  Subject,
  takeUntil,
  timer,
  toArray,
} from "rxjs";
import { Source } from "../contracts/Source";
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

  private containers?: Observable<Container[]>;
  private events?: Observable<ContainerEvent>;

  public constructor(
    private readonly source: Source,
    private readonly throttleService: ThrottleService,
  ) {}

  public streamContainers(): Observable<Container[]> {
    this.containers ??= defer(() => this.initRawContainerStream()) //
      .pipe(
        share({
          connector: () => new ReplaySubject(1),
          resetOnRefCountZero: false,
        }),
      );
    return this.containers;
  }

  public streamEvents(): Observable<ContainerEvent> {
    this.events ??= defer(() => this.initRawSocketStream()) //
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

  private initRawContainerStream(): Observable<Container[]> {
    const OVERVIEW = new Map<string, Container>();
    const RECONCILIATION_INTERVAL = Temporal.Duration.from({ minutes: 1 });

    const arrivals = new Subject<Container>();
    const departures = new Subject<string>();

    const update = (did: string, next: (previous: Container) => Container): boolean => {
      const previous = OVERVIEW.get(did);
      if (!previous) {
        return false; // a throughput or sample that outlived its container
      }
      const updated = next(previous);
      if (Container.equals(previous, updated)) {
        return false;
      }
      OVERVIEW.set(did, updated);
      return true;
    };

    const annotate = (did: string, patch: Partial<LiveStats>): boolean => {
      return update(did, (previous) => ({
        ...previous,
        liveStats: { ...previous.liveStats, ...patch } as LiveStats,
      }));
    };

    const introduce = (container: Container): boolean => {
      if (OVERVIEW.has(container.did)) {
        return update(container.did, (previous) => ({ ...previous, ...container, liveStats: previous.liveStats })); // a rename, at most
      }
      OVERVIEW.set(container.did, {
        ...container,
        liveStats: {
          throttling: false,
          logsPerSecond: 0,
          memoryTotal: 0,
          memoryUsage: 0,
          cpuTotal: 0,
          cpuUsage: 0,
        },
      });
      arrivals.next(container);
      return true;
    };

    const retire = (did: string): boolean => {
      if (!OVERVIEW.delete(did)) {
        return false;
      }
      departures.next(did);
      return true;
    };

    const wasAnythingUpdated = (changes: boolean[]): boolean => changes.includes(true);

    // subscribed first, so it is listening by the time the sources below announce anything
    const samples = arrivals.pipe(
      mergeMap((container) =>
        this.stats(container).pipe(
          takeUntil(departures.pipe(filter((did) => did === container.did))),
          filter((sample) => annotate(container.did, sample)),
        ),
      ),
    );

    const lifecycles = this.streamEvents().pipe(
      filter((event) => {
        switch (event.type) {
          case ContainerEvent.Type.start:
            return introduce(event.container);
          case ContainerEvent.Type.stop:
            return retire(event.container.did);
          default:
            return false;
        }
      }),
    );

    // catches whatever was running before we started listening, and any `die` we missed since
    const reconciliations = timer(0, RECONCILIATION_INTERVAL.total("milliseconds")) //
      .pipe(
        exhaustMap(() => this.burstRunningContainers().pipe(toArray())),
        filter((containers) => {
          const containerIds = new Set(containers.map((c) => c.did));
          const toBeRetiredContainerIds = [...OVERVIEW.keys()].filter((did) => !containerIds.has(did));
          return wasAnythingUpdated([...containers.map(introduce), ...toBeRetiredContainerIds.map(retire)]);
        }),
      );

    const throughputs = this.throttleService.streamThroughputs().pipe(
      filter((throughputs) => {
        return wasAnythingUpdated(
          throughputs.map(({ container, throttling, logsPerSecond }) => annotate(container.did, { throttling, logsPerSecond })),
        );
      }),
    );

    return merge(samples, lifecycles, reconciliations, throughputs).pipe(map(() => [...OVERVIEW.values()]));
  }

  private initRawSocketStream(): Observable<ContainerEvent.Start | ContainerEvent.Stop | ContainerEvent.Log> {
    const CONTAINERS_BEING_FOLLOWED = new Set<string>();

    const lifecycle = this.streamLifecycles().pipe(share());

    const isStopped = (did: string): Observable<ContainerEvent.Stop> => {
      return lifecycle.pipe(
        filter((event) => event.container.did === did),
        filter((event): event is ContainerEvent.Stop => event.type === ContainerEvent.Type.stop),
      );
    };

    const followLogs = (container: Container): Observable<ContainerEvent.Log> => {
      if (CONTAINERS_BEING_FOLLOWED.has(container.did)) {
        return EMPTY;
      }
      CONTAINERS_BEING_FOLLOWED.add(container.did);
      return this.logs(container).pipe(takeUntil(isStopped(container.did)));
    };

    return merge(
      this.burstRunningContainers().pipe(mergeMap(followLogs)),
      lifecycle.pipe(
        mergeMap((event) => {
          switch (event.type) {
            case ContainerEvent.Type.start: {
              return merge(of(event), followLogs(event.container));
            }
            case ContainerEvent.Type.stop: {
              CONTAINERS_BEING_FOLLOWED.delete(event.container.did);
              return of(event);
            }
          }
        }),
      ),
    );
  }

  private burstRunningContainers(): Observable<Container> {
    return defer(() => this.source.listRunningContainers()) //
      .pipe(
        retry({
          delay: (error, retryCount) => this.exponentialBackoff(retryCount, "Could not list running containers", error),
          resetOnSuccess: true,
        }),
        mergeMap((containers) => from(containers)),
      );
  }

  private streamLifecycles(): Observable<ContainerEvent.Start | ContainerEvent.Stop> {
    return this.toObservable((signal) => this.source.streamLifecycles(signal)) //
      .pipe(
        map(({ status, timestamp, container }): ContainerEvent.Start | ContainerEvent.Stop => {
          switch (status) {
            case "start":
              return {
                type: ContainerEvent.Type.start,
                object: "container_event",
                id: Bun.randomUUIDv7(),
                timestamp,
                container,
              };
            case "die":
              return {
                type: ContainerEvent.Type.stop,
                object: "container_event",
                id: Bun.randomUUIDv7(),
                timestamp,
                container,
              };
          }
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
    return this.toObservable((signal) => this.source.streamLogLines(container.did, signal)) //
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
          delay: (error, retryCount) => this.exponentialBackoff(retryCount, `Log stream failed for ${container.dname}`, error),
          resetOnSuccess: true, // a stream that ran fine for hours starts its next trouble from scratch
        }),
        repeat({
          // retry indefinitely when the stream closes cleanly
          delay: (retryCount) => this.exponentialBackoff(retryCount, `Log stream closed for ${container.dname}`),
        }),
      );
  }

  private stats(container: Container): Observable<Source.Stats> {
    return this.toObservable((signal) => this.source.streamStats(container.did, signal)) //
      .pipe(
        retry({
          delay: (error, retryCount) => this.exponentialBackoff(retryCount, `Stats stream failed for ${container.dname}`, error),
          resetOnSuccess: true,
        }),
        repeat({
          delay: (retryCount) => this.exponentialBackoff(retryCount, `Stats stream closed for ${container.dname}`),
        }),
      );
  }

  /**
   * `retryCount` = 1,2,3,4,5,...
   */
  private exponentialBackoff(retryCount: number, message: string, error?: unknown): Observable<unknown> {
    const min = Temporal.Duration.from({ milliseconds: 100 });
    const max = Temporal.Duration.from({ minutes: 1 });

    // 100ms -> 200ms -> 400ms -> ... -> 25.6s -> 51.2s -> 60s -> 60s ....
    const delay = Math.min(max.total("milliseconds"), min.total("milliseconds") * Math.pow(2, retryCount - 1));

    const logMessage = `${message}, retrying in ${delay}ms (#${retryCount})`;
    if (!error) {
      this.log.debug(logMessage);
    } else if (retryCount === 1) {
      this.log.warn(logMessage, error);
    } else {
      // the stack trace went out with the first attempt; the count restarts on success, so it does so per outage
      this.log.warn(`${logMessage}: ${error instanceof Error ? error.message : error}`);
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
