import { DologEvent } from "@/models/DologEvent";
import { Throughput } from "@/models/Throughput";
import { Observable } from "rxjs";
import { FountainService } from "./streaming/FountainService";

/**
 * What the server asks about containers. Both streams below already multicast and the throughput one
 * replays its latest reading, so nothing is shared or cached here -- this is the seam where
 * container-facing logic will land as the api grows.
 */
export class ContainerService {
  private fountain?: Observable<DologEvent>;

  public constructor(private readonly fountainService: FountainService) {}

  public activateFountain(): Observable<DologEvent> {
    this.fountain ??= this.fountainService.activate();
    return this.fountain;
  }

  public throughputs(): Observable<Throughput[]> {
    return this.fountainService.throughputs();
  }
}
