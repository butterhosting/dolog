import { ContainerEvent } from "@/models/ContainerEvent";
import { Throughput } from "@/models/Throughput";
import { filter, Observable } from "rxjs";
import { Fountain } from "./streaming/Fountain";
import { ContainerEventRepository } from "@/repositories/ContainerEventRepository";
import { Container } from "@/models/Container";

export class LogService {
  private readonly events: Observable<ContainerEvent>;
  private readonly throughputs: Observable<Throughput[]>;
  private readonly containers: Observable<Container[]>;

  public constructor(fountain: Fountain, containerEventRepository: ContainerEventRepository) {
    this.events = fountain.streamEvents();
    this.throughputs = fountain.streamThroughputs();
    this.containers = containerEventRepository.streamContainers();
  }

  /**
   * Everything happening to one container, for a websocket client to follow. Nothing is subscribed
   * until a client asks, and it stops again as soon as they disconnect.
   */
  public streamEvents(containerId: string): Observable<ContainerEvent> {
    return this.events.pipe(filter((event) => event.container.id === containerId));
  }

  /** Every container ever recorded, republished whenever that set changes. */
  public streamContainers(): Observable<Container[]> {
    return this.containers;
  }

  public streamThroughputs(): Observable<Throughput[]> {
    return this.throughputs;
  }
}
