import { ContainerEvent } from "@/models/ContainerEvent";
import { Observable } from "rxjs/internal/Observable";
import { Fountain } from "./streaming/Fountain";

export class AlertingService {
  private readonly stream: Observable<ContainerEvent>;

  public constructor(fountain: Fountain) {
    this.stream = fountain.stream();
  }

  // TODO: match log messages against the configured rules and notify the alert destinations
  public initialize() {
    void this.stream;
  }
}
