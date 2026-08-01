import { DologEvent } from "@/models/DologEvent";
import { Throughput } from "@/models/Throughput";
import { Observable, share } from "rxjs";
import { DockerFountain } from "./docker/DockerFountain";
import { ThrottleService } from "./ThrottleService";

export class ContainerService {
  private events?: Observable<DologEvent>;

  public constructor(
    private readonly dockerFountain: DockerFountain,
    private readonly throttleService: ThrottleService,
  ) {}

  public initializeStream(): Observable<DologEvent> {
    this.events ??= this.throttleService //
      .throttle(this.dockerFountain.stream())
      .pipe(share({ resetOnRefCountZero: false }));
    return this.events;
  }

  public throughput(): Throughput[] {
    return this.throttleService.dashboard();
  }
}
