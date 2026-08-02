import { DologEvent } from "@/models/DologEvent";
import { Observable } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class RetentionService {
  private readonly stream: Observable<DologEvent>;

  public constructor(fountain: Fountain) {
    this.stream = fountain.stream();
  }
}
