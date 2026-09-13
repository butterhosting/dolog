import { $container, $containerEvent } from "@/drizzle/schema";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { StreamVariant } from "@/models/StreamVariant";
import { Uuid } from "@/models/Uuid";
import { Temporal } from "@js-temporal/polyfill";
import { InferInsertModel, InferSelectModel } from "drizzle-orm";

export namespace ContainerEventConverter {
  type $Container = InferSelectModel<typeof $container>;
  type $ContainerEvent = InferSelectModel<typeof $containerEvent>;
  type $NewContainerEvent = InferInsertModel<typeof $containerEvent>;

  export function toDatabase(model: ContainerEvent, containerId: number): $NewContainerEvent {
    return {
      id: Uuid.toBytes(model.id),
      containerId,
      timestamp: model.timestamp.toString(),
      type: model.type,
      streamVariant: model.type === ContainerEvent.Type.log ? model.streamVariant : null,
      line: model.type === ContainerEvent.Type.log ? model.line : null,
      dropCount: model.type === ContainerEvent.Type.log_throttle ? model.dropCount : null,
    };
  }

  export function eventFromDatabase(db: $ContainerEvent, containersCatalog: Array<InferSelectModel<typeof $container>>): ContainerEvent {
    const container = containersCatalog.find((c) => c.id === db.containerId);
    if (!container) {
      throw new Error(`Illegal state; container should logically always be present in catalog`);
    }
    const common = {
      object: "container_event",
      id: Uuid.fromBytes(db.id),
      timestamp: Temporal.Instant.from(db.timestamp),
      container: containerFromDatabase(container),
    } as const;
    switch (db.type as ContainerEvent.Type) {
      case ContainerEvent.Type.start:
        return { ...common, type: ContainerEvent.Type.start };
      case ContainerEvent.Type.stop:
        return { ...common, type: ContainerEvent.Type.stop };
      case ContainerEvent.Type.log_throttle:
        return { ...common, type: ContainerEvent.Type.log_throttle, dropCount: db.dropCount ?? 0 };
      case ContainerEvent.Type.log:
        return {
          ...common,
          type: ContainerEvent.Type.log,
          streamVariant: (db.streamVariant as StreamVariant | null) ?? StreamVariant.stdout,
          line: db.line ?? "",
        };
    }
  }

  export function containerFromDatabase(db: $Container): Container {
    return {
      object: "container",
      did: db.did,
      dname: db.dname,
      dgroup: db.dgroup ?? undefined,
      dimage: db.dimage,
      dlabels: db.dlabels,
    };
  }
}
