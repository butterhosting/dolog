import { Env } from "@/Env";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerEventRepository } from "@/repositories/ContainerEventRepository";
import { catchError, concatMap, defer, EMPTY, interval, Observable, startWith } from "rxjs";
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
      this.persist();
      this.prunePeriodically();
    }
  }

  private persist() {
    this.events.subscribe({
      next: (event) => this.repository.save(event),
      error: (error) => this.log.error("Stopped recording events", error),
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

  /**
   * Two caps, guarding different failures. The per-container one keeps a chatty container from
   * evicting everybody else's history, and usually does all the work. The size one is the backstop
   * for when many well-behaved containers add up to more disk than we have.
   */
  private async prune(): Promise<void> {
    const perContainer = this.env.X_DOLOG_RETENTION_MAX_EVENTS_PER_CONTAINER;
    const megabytes = this.env.X_DOLOG_RETENTION_MAX_MEGABYTES;

    const fairness = await this.repository.pruneToEventsPerContainer(perContainer);
    if (fairness.events > 0) {
      this.log.info(`Pruned ${fairness.events} events, keeping at most ${perContainer} per container`);
    }
    const disk = await this.repository.pruneToSize(megabytes * 1024 * 1024);
    if (disk.events > 0) {
      this.log.info(`Pruned ${disk.events} events and ${disk.containers} containers to stay under ${megabytes}MB`);
    }
  }
}
