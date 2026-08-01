import { ContainerEvent } from "@/models/ContainerEvent";
import { Throughput } from "@/models/Throughput";
import { Observable, share } from "rxjs";
import { DockerFountain } from "./docker/DockerFountain";
import { ThrottleService } from "./ThrottleService";

/**
 * Owns the one throttled event stream every consumer shares. Retention, alerting and the frontend
 * websocket all attach here rather than opening their own connection to Docker.
 */
export class ContainerService {
  private events?: Observable<ContainerEvent>;

  public constructor(
    private readonly dockerFountain: DockerFountain,
    private readonly throttleService: ThrottleService,
  ) {}

  public initialize(): Observable<ContainerEvent> {
    this.events ??= this.throttleService //
      .throttle(this.dockerFountain.initialize())
      .pipe(share({ resetOnRefCountZero: false }));
    return this.events;
  }

  public throughput(): Throughput[] {
    return this.throttleService.dashboard();
  }
}
