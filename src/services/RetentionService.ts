import { Env } from "@/Env";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { EventRepository } from "@/repositories/EventRepository";
import { catchError, concatMap, defer, EMPTY, interval, Observable, startWith } from "rxjs";
import { Fountain } from "./streaming/Fountain";
import { Temporal } from "@js-temporal/polyfill";

export class RetentionService {
  private readonly log = new Logger(__filename);
  private readonly events: Observable<ContainerEvent>;

  public constructor(
    fountain: Fountain,
    private readonly env: Env.Private,
    private readonly logRepository: EventRepository,
  ) {
    this.events = fountain.streamEvents();
  }

  @Initialize
  public persistIncomingEvents() {
    this.events.subscribe({
      next: (event) => this.logRepository.saveEvent(event),
      error: (error) => this.log.error("Stopped recording events", error),
    });
  }

  @Initialize
  public prunePeriodically() {
    const PRUNE_INTERVAL = Temporal.Duration.from({ minutes: 10 });
    interval(PRUNE_INTERVAL.total("milliseconds"))
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
    const perContainer = this.env.X_DOLOG_RETENTION_MAX_LINES_PER_CONTAINER;
    const window = this.env.X_DOLOG_RETENTION_TIME_WINDOW;

    // Lines-per-container strategy
    const fairness = await this.logRepository.pruneEventsPerContainer(perContainer);
    if (fairness.eventDeleteCount > 0) {
      this.log.info(`Pruned ${fairness.eventDeleteCount} events, keeping at most ${perContainer} per container`);
    }

    // Temporal cut-off strategy
    const cutoff = Temporal.Now.instant().subtract({ milliseconds: window.total("milliseconds") });
    const expired = await this.logRepository.pruneEventsOlderThan(cutoff);
    if (expired.eventDeleteCount > 0) {
      this.log.info(
        `Pruned ${expired.eventDeleteCount} events and ${expired.containerDeleteCount} containers older than ${window.toString()}`,
      );
    }
  }
}
