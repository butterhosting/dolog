import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Alert } from "@/models/Alert";
import { StreamVariant } from "@/models/StreamVariant";
import { Svc } from "@/models/Svc";
import { Throughput } from "@/models/Throughput";
import { Temporal } from "@js-temporal/polyfill";
import { Route } from "@/website/Route";

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

export namespace TestFixture {
  export function container(overrides: DeepPartial<Container> = {}): Container {
    const defaults: Container = {
      did: Bun.randomUUIDv7(),
      object: "container",
      dname: "web",
      dgroup: "shop",
      dimage: "nginx:1.27",
      dlabels: {},
    };
    return deepMerge(defaults, overrides);
  }

  export function logEvent(overrides: DeepPartial<ContainerEvent.Log> = {}): ContainerEvent.Log {
    const defaults: ContainerEvent.Log = {
      object: "container_event",
      id: Bun.randomUUIDv7(),
      type: ContainerEvent.Type.log,
      timestamp: Temporal.Now.instant(),
      container: container(),
      streamVariant: StreamVariant.stdout,
      line: "GET / 200",
    };
    return deepMerge(defaults, overrides);
  }

  export function startEvent(overrides: DeepPartial<ContainerEvent.Start> = {}): ContainerEvent.Start {
    const defaults: ContainerEvent.Start = {
      object: "container_event",
      id: Bun.randomUUIDv7(),
      type: ContainerEvent.Type.start,
      timestamp: Temporal.Now.instant(),
      container: container(),
    };
    return deepMerge(defaults, overrides);
  }

  export function stopEvent(overrides: DeepPartial<ContainerEvent.Stop> = {}): ContainerEvent.Stop {
    const defaults: ContainerEvent.Stop = {
      object: "container_event",
      id: Bun.randomUUIDv7(),
      type: ContainerEvent.Type.stop,
      timestamp: Temporal.Now.instant(),
      container: container(),
    };
    return deepMerge(defaults, overrides);
  }

  export function logThrottleEvent(overrides: DeepPartial<ContainerEvent.LogThrottle> = {}): ContainerEvent.LogThrottle {
    const defaults: ContainerEvent.LogThrottle = {
      object: "container_event",
      id: Bun.randomUUIDv7(),
      type: ContainerEvent.Type.log_throttle,
      timestamp: Temporal.Now.instant(),
      container: container(),
      dropCount: 3,
    };
    return deepMerge(defaults, overrides);
  }

  export function throughput(overrides: DeepPartial<Throughput> = {}): Throughput {
    const defaults: Throughput = {
      object: "throughput",
      container: container(),
      throttling: false,
      logsPerSecond: 1,
      bytesPerSecond: 10,
    };
    return deepMerge(defaults, overrides);
  }

  export function textAlert(overrides: DeepPartial<Alert.Text> = {}): Alert.Text {
    const defaults: Alert.Text = {
      object: "alert",
      id: Bun.randomUUIDv7(),
      type: Alert.Type.text,
      timestamp: Temporal.Now.instant(),
      service: {
        id: Svc.encodeId({ dname: "web", dgroup: "shop" }),
        link: Route.svcsLogs(Svc.encodeId({ dname: "web", dgroup: "shop" })),
        dname: "web",
        dgroup: "shop",
      },
      containerEventId: Bun.randomUUIDv7(),
      match: { pattern: "ERROR", line: "ERROR boom" },
    };
    return deepMerge(defaults, overrides);
  }

  export function throughputAlert(overrides: DeepPartial<Alert.Throughput> = {}): Alert.Throughput {
    const defaults: Alert.Throughput = {
      object: "alert",
      id: Bun.randomUUIDv7(),
      type: Alert.Type.throughput,
      timestamp: Temporal.Now.instant(),
      service: {
        id: Svc.encodeId({ dname: "web", dgroup: "shop" }),
        link: Route.svcsLogs(Svc.encodeId({ dname: "web", dgroup: "shop" })),
        dname: "web",
        dgroup: "shop",
      },
      breach: { threshold: 100, logsPerSecond: 250 },
    };
    return deepMerge(defaults, overrides);
  }

  function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function deepMerge<T extends object>(target: T, source: DeepPartial<T>): T {
    const result = { ...target } as Record<string, unknown>;
    for (const key in source) {
      const sourceVal = (source as Record<string, unknown>)[key];
      const targetVal = result[key];
      if (sourceVal !== undefined) {
        if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
          result[key] = deepMerge(targetVal, sourceVal);
        } else {
          result[key] = sourceVal;
        }
      }
    }
    return result as T;
  }
}
