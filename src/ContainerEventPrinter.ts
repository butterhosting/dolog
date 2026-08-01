import { ContainerEvent } from "@/models/ContainerEvent";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

export namespace ContainerEventPrinter {
  export function format(event: ContainerEvent): string {
    const timestamp = event.timestamp.toString({ smallestUnit: "millisecond" });
    const name = event.container.group ? `${event.container.group}/${event.container.name}` : event.container.name;
    return `${DIM}${timestamp}${RESET} ${BOLD}${name}${RESET} ${body(event)}`;
  }

  function body(event: ContainerEvent): string {
    switch (event.type) {
      case ContainerEvent.Type.start:
        return `${GREEN}▲ started${RESET}`;
      case ContainerEvent.Type.stop:
        return `${RED}▼ stopped${RESET}`;
      case ContainerEvent.Type.log:
        return event.stream === ContainerEvent.Stream.stderr ? `${RED}${event.message}${RESET}` : event.message;
      case ContainerEvent.Type.throttle:
        return `${YELLOW}⚡ throttled, folded ${event.foldCount} messages${RESET}`;
    }
  }
}
