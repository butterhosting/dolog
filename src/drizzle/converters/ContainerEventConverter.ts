import { $container, $containerEvent } from "@/drizzle/schema";
import { Uuid } from "@/helpers/Uuid";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { StreamVariant } from "@/models/StreamVariant";
import { Temporal } from "@js-temporal/polyfill";
import { InferInsertModel, InferSelectModel } from "drizzle-orm";

/**
 * Translates between the domain models and their database representation.
 *
 * The direction is explicit on purpose: a `Partial<ContainerEvent>` and a `Partial<$ContainerEvent>`
 * are not reliably distinguishable at runtime, and picking the wrong one silently passes
 * `Temporal.Instant`s straight into the driver.
 *
 * Events are stored against a container's surrogate id, so writing one needs that id supplied
 * alongside the model.
 */
export namespace ContainerEventConverter {
  type $Container = InferSelectModel<typeof $container>;
  type $ContainerEvent = InferSelectModel<typeof $containerEvent>;
  type $NewContainerEvent = InferInsertModel<typeof $containerEvent>;

  export function toDatabase(model: ContainerEvent, container: number): $NewContainerEvent {
    return {
      id: Uuid.toBytes(model.id),
      container,
      timestamp: model.timestamp.toString(),
      type: model.type,
      streamVariant: model.type === ContainerEvent.Type.log ? model.streamVariant : null,
      line: model.type === ContainerEvent.Type.log ? model.line : null,
      foldCount: model.type === ContainerEvent.Type.log_throttle ? model.foldCount : null,
    };
  }

  export function fromDatabase(db: $ContainerEvent, container: Container): ContainerEvent {
    const common = {
      object: "container_event",
      id: Uuid.fromBytes(db.id),
      timestamp: Temporal.Instant.from(db.timestamp),
      container,
    } as const;
    switch (db.type as ContainerEvent.Type) {
      case ContainerEvent.Type.start:
        return { ...common, type: ContainerEvent.Type.start };
      case ContainerEvent.Type.stop:
        return { ...common, type: ContainerEvent.Type.stop };
      case ContainerEvent.Type.log_throttle:
        return { ...common, type: ContainerEvent.Type.log_throttle, foldCount: db.foldCount ?? 0 };
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
    return Container.parse({
      id: db.dockerId,
      object: "container",
      name: db.name,
      group: db.groupName ?? undefined,
    });
  }
}
