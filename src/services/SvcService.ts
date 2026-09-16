import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Container } from "@/models/Container";
import { Svc } from "@/models/Svc";
import { EventRepository } from "@/repositories/EventRepository";
import { SocketService } from "@/services/SocketService";
import { Temporal } from "@js-temporal/polyfill";
import { auditTime, filter, firstValueFrom, map, Observable, pipe, ReplaySubject, share, startWith } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class SvcService {
  private readonly log = new Logger(__filename);
  private readonly svcs: Observable<Svc[]>;

  public constructor(
    fountain: Fountain,
    private readonly eventRepository: EventRepository,
    private readonly socketService: SocketService,
  ) {
    this.svcs = fountain.streamContainers().pipe(this.combineWithHistoricContainersIntoSvcs());
  }

  @Initialize
  public broadcastSvcStream() {
    const BROADCAST_INTERVAL = Temporal.Duration.from({ seconds: 1 });
    this.svcs
      .pipe(
        auditTime(BROADCAST_INTERVAL.total("milliseconds")),
        filter(() => this.socketService.hasConnections()),
      )
      .subscribe({
        next: (svcs) => this.socketService.broadcastSvcStream(svcs),
        error: (error) => this.log.error("Stopped pushing container updates", error),
      });
  }

  public async list(): Promise<Svc[]> {
    return firstValueFrom(this.svcs);
  }

  public streamSvcs(): Observable<Svc[]> {
    return this.svcs;
  }

  private combineWithHistoricContainersIntoSvcs() {
    return pipe(
      startWith<Container[]>([]),
      map((runningContainers) => this.toSvcs(runningContainers, this.eventRepository.listContainers())),
      share({
        connector: () => new ReplaySubject(1),
        resetOnRefCountZero: false,
      }),
    );
  }

  private toSvcs(runningcontainers: Container[], historicContainers: Container[]): Svc[] {
    const containers = new Map<string, Container>(historicContainers.map((container) => [container.did, container]));
    runningcontainers.forEach((container) => containers.set(container.did, container));

    const svcMap = new Map<string, Container[]>();
    containers.forEach((container) => {
      const id = Svc.encodeId({ dname: container.dname, dgroup: container.dgroup });
      if (svcMap.has(id)) {
        svcMap.get(id)!.push(container);
      } else {
        svcMap.set(id, [container]);
      }
    });

    return [...svcMap.entries()].map<Svc>(([id, svcContainers]) => {
      // docker names are unique per host, so a service has at most one running container
      const live = svcContainers.filter((container) => container.liveStats);
      if (live.length > 1) {
        this.log.error(`Service ${svcContainers[0].dname} has ${live.length} running containers; showing the first`);
      }
      // the running container describes the service; failing that, the most recently active one (historic containers come sorted that way)
      const representative = live.at(0) ?? svcContainers[0];
      return {
        id,
        dname: representative.dname,
        dgroup: representative.dgroup,
        dimage: representative.dimage,
        dlabels: representative.dlabels,
        liveStats: representative.liveStats,
      };
    });
  }
}
