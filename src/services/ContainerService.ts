import { DologEvent } from "@/models/DologEvent";
import { Throughput } from "@/models/Throughput";
import { Observable } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class ContainerService {
  public constructor(private readonly fountain: Fountain) {}

  public activateFountain(): Observable<DologEvent> {
    return this.fountain.activate();
  }

  public throughput(): Throughput[] {
    return this.fountain.throughput();
  }
}
