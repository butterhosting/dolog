import { Env } from "@/Env";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { LogRepository } from "@/repositories/LogRepository";
import { catchError, concatMap, defer, EMPTY, interval, Observable, startWith } from "rxjs";
import { Fountain } from "./streaming/Fountain";
import { Temporal } from "@js-temporal/polyfill";

export class RetentionService {
  private readonly log = new Logger(__filename);
  private readonly events: Observable<ContainerEvent>;

  public constructor(
    fountain: Fountain,
    private readonly env: Env.Private,
    private readonly logRepository: LogRepository,
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

  /**
   * Size rather than age, because disk is what actually runs out: the ceiling holds however chatty
   * the host turns out to be, and no single container can spend the whole budget.
   */
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

  /**
   * Two caps doing two different jobs.
   *
   * The per-container one is the working limit: it bounds how much history any single container
   * keeps, so a chatty one cannot evict everybody else's, and it is the one an operator actually
   * tunes. "Keep the last hundred thousand lines" is a sentence you can hold in your head.
   *
   * The window is the long tail. It forgets containers nobody has looked at in months, and it is the
   * only one that reliably returns disk: deleting by age is one contiguous run of the clustered key,
   * where the per-container sweep deletes a scattered subset that frees very few whole pages.
   */
  private async prune(): Promise<void> {
    const perContainer = this.env.X_DOLOG_RETENTION_MAX_EVENTS_PER_CONTAINER;
    const window = this.env.X_DOLOG_RETENTION_WINDOW;

    const fairness = await this.logRepository.pruneToEventsPerContainer(perContainer);
    if (fairness.events > 0) {
      this.log.info(`Pruned ${fairness.events} events, keeping at most ${perContainer} per container`);
    }
    // in milliseconds, because an Instant refuses to subtract a duration counted in days
    const cutoff = Temporal.Now.instant().subtract({ milliseconds: window.total("milliseconds") });
    const expired = await this.logRepository.pruneOlderThan(cutoff);
    if (expired.events > 0) {
      this.log.info(`Pruned ${expired.events} events and ${expired.containers} containers older than ${window.toString()}`);
    }
  }
}
