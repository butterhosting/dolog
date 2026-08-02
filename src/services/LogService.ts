import { DologEvent } from "@/models/DologEvent";
import { Throughput } from "@/models/Throughput";
import { Observable } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class LogService {
  private readonly stream: Observable<DologEvent>;
  private readonly throughputs: Observable<Throughput[]>;

  public constructor(fountain: Fountain) {
    this.stream = fountain.stream();
    this.throughputs = fountain.throughputs();
  }
}
