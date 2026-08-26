import { Observable, Subject } from "rxjs";
import { EventRepository } from "./EventRepository";
import { Container } from "@/models/Container";
import { Service } from "@/models/Service";

export class ServiceRepository {
  private readonly services: Observable<Service[]> = new Subject();

  public constructor(private readonly eventRepository: EventRepository) {
    // this.containers = eventRepository.streamContainers();
  }
}
