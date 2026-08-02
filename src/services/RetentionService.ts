import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { bufferTime, catchError, concatMap, defer, EMPTY, filter, Observable, retry } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class RetentionService {
  private readonly log = new Logger(__filename);
  private readonly stream: Observable<ContainerEvent>;
  private initialized = false;

  public constructor(fountain: Fountain) {
    this.stream = fountain.stream();
  }

  public initialize() {
    const FLUSH_INTERVAL_MS = 1_000;
    const FLUSH_MAX_BATCH = 500;
    const RETRY_DELAY_MS = 2_000;
    const RETRY_COUNT = 2;

    if (!this.initialized) {
      this.initialized = true;
      this.stream
        .pipe(
          bufferTime(FLUSH_INTERVAL_MS, null, FLUSH_MAX_BATCH),
          filter((batch) => batch.length > 0),
          // `concatMap` keeps writes in order and stops them overlapping: the next batch waits for the
          // current one to land. `defer` matters here: without it `persist` would be called once up
          // front, and a retry would re-subscribe to a promise that had already settled
          concatMap((batch) =>
            defer(() => this.persist(batch)).pipe(
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
  }

  private async persist(batch: ContainerEvent[]): Promise<void> {
    this.log.debug(() => {
      const perContainer = new Map<string, number>();
      batch.forEach(({ container }) => perContainer.set(container.name, (perContainer.get(container.name) ?? 0) + 1));
      const description = [...perContainer]
        .sort(([, a], [, b]) => b - a)
        .map(([name, count]) => `${name}=${count}`)
        .join(", ");
      return `Persisting ${batch.length} log events (${description})`;
    });
  }
}
