import { Prettify } from "@/helpers/Prettify";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { Ansi } from "@/website/rendering/Ansi";
import { Line } from "@/website/rendering/Line";
import { RowMarker } from "@/website/rendering/RowMarker";
import { Severity } from "@/website/rendering/Severity";
import { TimestampPrefix } from "@/website/rendering/TimestampPrefix";
import clsx from "clsx";
import { ReactNode, useMemo } from "react";
import { JSX } from "react/jsx-runtime";
import { useRegistry } from "../hooks/basics/useRegistry";
import { ClientFilter } from "../hooks/objects/ClientFilter";

/**
 * Every row lines its message up under the same column. The timestamp is `19ch` because that is
 * exactly what it prints, so the column follows the text size rather than being re-measured for each.
 */
const TIMESTAMP = "w-[19ch] shrink-0 text-left";
// `anywhere` rather than `break-all`, so a long url gives way only where it has to and words stay whole
const MESSAGE = "min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]";

export namespace Row {
  type BeginningOfTimeProps = {
    line: Line.BeginningOfTime;
  };
  export function BeginningOfTime({ line: _ }: BeginningOfTimeProps) {
    return <Internal.CenterBox className="text-c-rule italic">this is the beginning</Internal.CenterBox>;
  }

  type ScrollTeaserProps = {
    line: Line.ScrollTeaser;
  };
  export function ScrollTeaser({ line: { direction } }: ScrollTeaserProps): JSX.Element {
    switch (direction) {
      case Direction.backwards_in_time:
        return <Internal.CenterBox bordered>↑ scroll up for earlier records</Internal.CenterBox>;
      case Direction.forwards_in_time:
        return <Internal.CenterBox bordered>↓ scroll down for later records</Internal.CenterBox>;
    }
  }

  type DayTransitionProps = {
    line: Line.DayTransition;
  };
  export function DayTransition({ line: { day } }: DayTransitionProps) {
    return <Internal.CenterBox bordered>{Prettify.dayTransition(day)}</Internal.CenterBox>;
  }

  type TimestampAnchorProps = {
    line: Line.TimestampAnchor;
    dismiss: () => unknown;
  };

  export function TimestampAnchor({ line: { timestamp }, dismiss }: TimestampAnchorProps) {
    const { DOLOG_TIMEZONE } = useRegistry("env");
    return (
      <div {...RowMarker.props({ isAnchored: true })} className="relative flex justify-center my-5">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-c-accent" />
        <button
          onClick={dismiss}
          title="dismiss this marker"
          className="relative bg-c-surface px-[1ch] text-c-accent cursor-pointer hover:brightness-125"
        >
          ({Prettify.timestamp(timestamp, DOLOG_TIMEZONE)})
        </button>
      </div>
    );
  }

  type EventProps = {
    line: Line.Event;
    filter: ClientFilter;
    toggleAnchor: () => unknown;
    match?: RowMarker.Match;
  };
  export function Event({ line: { event, isAnchored, isStriped, repeatsTimestamp }, filter, toggleAnchor, match }: EventProps) {
    const { DOLOG_TIMEZONE } = useRegistry("env");
    // memoized per row, so a line is read once when it arrives rather than on every render of the window
    const log = useMemo(
      () =>
        event.type === ContainerEvent.Type.log
          ? { severity: Severity.guess(event.line), segments: Ansi.parse(event.line.slice(TimestampPrefix.length(event.line, event.timestamp))) }
          : undefined,
      [event],
    );
    return (
      <div
        {...RowMarker.props({ eventId: event.id, isAnchored, match })}
        className={clsx(
          "group/row -mx-2 flex items-start border-y border-transparent px-2 py-1.5",
          log && isStriped && !match && "bg-c-stripe",
          match === "main_match" && "bg-c-accent/30",
          match === "side_match" && "bg-c-accent/12",
          isAnchored && "border-c-accent!",
          event.type !== ContainerEvent.Type.log && "my-2 py-2",
          event.type === ContainerEvent.Type.start && "bg-linear-to-r from-green-950 to-c-surface",
          event.type === ContainerEvent.Type.stop && "bg-linear-to-r from-red-950 to-c-surface",
          event.type === ContainerEvent.Type.log_throttle && "bg-linear-to-r from-yellow-950 to-c-surface",
        )}
      >
        <button
          onClick={toggleAnchor}
          title="mark this line"
          className={clsx(
            TIMESTAMP,
            "cursor-pointer",
            // a repeated time hides, but stays where it is: it is also the button that marks the line
            repeatsTimestamp && !isAnchored && match !== "main_match"
              ? "text-transparent group-hover/row:text-c-rule focus-visible:text-c-rule"
              : "text-c-rule hover:text-white",
          )}
        >
          {Prettify.timestamp(event.timestamp, DOLOG_TIMEZONE)}
        </button>
        <Internal.SeverityMarker isLog={Boolean(log)} severity={log?.severity} />
        {(() => {
          const id = <span className="underline underline-offset-2">{event.container.did.slice(0, 7)}</span>;
          switch (event.type) {
            case ContainerEvent.Type.start:
              return <div className={MESSAGE}>🟢 Container {id} has started</div>;
            case ContainerEvent.Type.stop:
              return <div className={MESSAGE}>🔴 Container {id} has stopped</div>;
            case ContainerEvent.Type.log_throttle: {
              if (filter.pattern) {
                // Don't show the drop count if a filter pattern is currently active ...
                // ... it would be misleading and confusing to show how many records just got dropped in the non-filtered stream
                return <div className={MESSAGE}>⚡️ Container {id} was throttled</div>;
              }
              return (
                <div className={MESSAGE}>
                  ⚡️ Container {id} was throttled; {event.dropCount} messages dropped
                </div>
              );
            }
            case ContainerEvent.Type.log:
              return (
                <div className={MESSAGE}>
                  {log?.segments.map((segment, index) => (
                    <span key={index} style={segment.style}>
                      {segment.text}
                    </span>
                  ))}
                </div>
              );
            default:
              event satisfies never;
          }
        })()}
      </div>
    );
  }
}

namespace Internal {
  const SEVERITY_COLORS: Record<Severity, string> = {
    [Severity.trace]: "bg-c-severity-debug",
    [Severity.debug]: "bg-c-severity-debug",
    [Severity.info]: "bg-c-severity-info",
    [Severity.warn]: "bg-c-severity-warn",
    [Severity.error]: "bg-c-severity-error",
    [Severity.fatal]: "bg-c-severity-error",
  };

  type SeverityMarkerProps = {
    isLog: boolean;
    severity?: Severity;
  };
  /** Fills the gap before the message either way, so every message starts in the same column */
  export function SeverityMarker({ isLog, severity }: SeverityMarkerProps) {
    return (
      // -my-1.5 undoes the row's py-1.5, so the rectangle runs the full height of the row
      <span title={severity} className="-my-1.5 flex w-[4ch] shrink-0 self-stretch justify-center">
        {/* a log line of unknown severity gets a black one, so the column has no gaps */}
        {isLog && <span className={clsx("w-[0.5em]", severity ? SEVERITY_COLORS[severity] : "bg-black")} />}
      </span>
    );
  }

  type CenterBoxProps = {
    children: ReactNode;
    bordered?: boolean;
    className?: string;
  };
  export function CenterBox({ children, bordered = false, className }: CenterBoxProps) {
    return (
      <div className="my-3">
        {bordered && <div className="h-px bg-c-rule/30" />}
        <div className={clsx("text-center py-3", className)}>{children}</div>
        {bordered && <div className="h-px bg-c-rule/30" />}
      </div>
    );
  }
}
