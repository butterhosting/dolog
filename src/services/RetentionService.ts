import { Env } from "@/Env";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerEventRepository } from "@/repositories/ContainerEventRepository";
import { bufferTime, catchError, concatMap, defer, EMPTY, filter, interval, Observable, retry, startWith } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class RetentionService {
  private readonly log = new Logger(__filename);
  private readonly events: Observable<ContainerEvent>;
  private initialized = false;

  public constructor(
    fountain: Fountain,
    private readonly env: Env.Private,
    private readonly repository: ContainerEventRepository,
  ) {
    this.events = fountain.streamEvents();
  }

  public initialize() {
    if (!this.initialized) {
      this.initialized = true;
      this.persistEvents();
      this.prunePeriodically();
    }
  }

  private persistEvents() {
    const FLUSH_INTERVAL_MS = 1_000;
    const FLUSH_MAX_BATCH = 500;
    const RETRY_DELAY_MS = 2_000;
    const RETRY_COUNT = 2;

    this.events
      .pipe(
        bufferTime(FLUSH_INTERVAL_MS, null, FLUSH_MAX_BATCH),
        filter((batch) => batch.length > 0),
        // `concatMap` keeps writes in order and stops them overlapping: the next batch waits for the
        // current one to land. `defer` matters here: without it `append` would be called once up
        // front, and a retry would re-subscribe to a promise that had already settled
        concatMap((batch) =>
          defer(() => this.repository.append(batch)).pipe(
            retry({ count: RETRY_COUNT, delay: RETRY_DELAY_MS }),
            // A batch we could not write is dropped rather than allowed to error the stream. Left
            // unhandled it would end this subscription silently, and retention would simply stop
            catchError((error) => {
              this.log.error(`Dropped ${batch.length} events after ${RETRY_COUNT} failed retries`, error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe({
        error: (error) => this.log.error("Retention stopped", error),
      });
  }

  /**
   * Size rather than age, because disk is what actually runs out: the ceiling holds however chatty
   * the host turns out to be, and no single container can spend the whole budget.
   */
  private prunePeriodically() {
    const PRUNE_INTERVAL_MS = 10 * 60 * 1_000;

    interval(PRUNE_INTERVAL_MS)
      .pipe(
        // so a restart with an already oversized database does not idle for a full interval first
        startWith(0),
        concatMap(() =>
          defer(() => this.prune()).pipe(
            catchError((error) => {
              this.log.error("Could not prune", error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe({
        error: (error) => this.log.error("Pruning stopped", error),
      });
  }

  private async prune(): Promise<void> {
    const megabytes = this.env.X_DOLOG_RETENTION_MAX_MEGABYTES;
    const { events, containers } = await this.repository.pruneToSize(megabytes * 1024 * 1024);
    if (events > 0) {
      this.log.info(`Pruned ${events} events and ${containers} containers to stay under ${megabytes}MB`);
    }
  }
}
