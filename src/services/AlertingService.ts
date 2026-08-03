import { Initialize } from "@/Initialize";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Observable } from "rxjs/internal/Observable";
import { Fountain } from "./streaming/Fountain";

export class AlertingService {
  private readonly events: Observable<ContainerEvent>;

  public constructor(fountain: Fountain) {
    this.events = fountain.streamEvents();
  }

  // TODO: match log messages against the configured rules and notify the alert destinations
  @Initialize
  public matchEventsAgainstAlertRules() {
    void this.events;
  }
}
