import { DologEvent } from "@/models/DologEvent";
import { Throughput } from "@/models/Throughput";
import { Observable } from "rxjs";
import { FountainService } from "./streaming/FountainService";

export class ContainerService {
  private fountain!: Observable<DologEvent>;
  private throughputs: Throughput[] = [];

  public constructor(private readonly fountainService: FountainService) {
    fountainService.throughputs().subscribe((t) => {
      this.throughputs = t;
    });
  }

  public activateFountain(): Observable<DologEvent> {
    this.fountain ??= this.fountainService.activate();
    return this.fountain;
  }
}
