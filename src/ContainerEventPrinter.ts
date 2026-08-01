import { ContainerEvent } from "./models/ContainerEvent";
import { DologEvent } from "./models/DologEvent";
import { StdStream } from "./models/StdStream";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

export namespace ContainerEventPrinter {
  export function format(event: DologEvent): string {
    const timestamp = event.timestamp.toString({ smallestUnit: "millisecond" });
    const name = event.container.group ? `${event.container.group}/${event.container.name}` : event.container.name;
    return `${DIM}${timestamp}${RESET} ${BOLD}${name}${RESET} ${body(event)}`;
  }

  function body(event: DologEvent): string {
    switch (event.object) {
      case "container_event": {
        switch (event.type) {
          case ContainerEvent.Type.start:
            return `${GREEN}▲ started${RESET}`;
          case ContainerEvent.Type.stop:
            return `${RED}▼ stopped${RESET}`;
          case ContainerEvent.Type.log:
            return event.stdStream === StdStream.err ? `${RED}${event.message}${RESET}` : event.message;
        }
      }
      case "throttle_event": {
        return `${YELLOW}⚡ throttled, folded ${event.foldCount} messages${RESET}`;
      }
    }
  }
}
