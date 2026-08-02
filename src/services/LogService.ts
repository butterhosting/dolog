import { ContainerEvent } from "@/models/ContainerEvent";
import { Throughput } from "@/models/Throughput";
import { filter, Observable } from "rxjs";
import { Fountain } from "./streaming/Fountain";

export class LogService {
  private readonly stream: Observable<ContainerEvent>;
  private readonly throughputs: Observable<Throughput[]>;

  public constructor(fountain: Fountain) {
    this.stream = fountain.stream();
    this.throughputs = fountain.throughputs();
  }

  /**
   * Everything happening to one container, for a websocket client to follow. Nothing is subscribed
   * until a client asks, and it stops as soon as they disconnect.
   */
  public liveEvents(containerId: string): Observable<ContainerEvent> {
    return this.stream.pipe(filter((event) => event.container.id === containerId));
  }

  public throughputOverview(): Observable<Throughput[]> {
    return this.throughputs;
  }
}
