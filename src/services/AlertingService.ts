import { DologEvent } from "@/models/DologEvent";
import { Observable } from "rxjs/internal/Observable";
import { Fountain } from "./streaming/Fountain";

export class AlertingService {
  private readonly stream: Observable<DologEvent>;

  public constructor(fountain: Fountain) {
    this.stream = fountain.stream();
  }
}
