import { ContainerEvent } from "@/models/ContainerEvent";
import { Direction } from "@/models/Direction";
import { StreamVariant } from "@/models/StreamVariant";
import clsx from "clsx";
import { ReactNode } from "react";
import { Line } from "../../rendering/Line";

export namespace LogRow {
  function DismissButton({ onDismiss, className }: { onDismiss: () => void; className: string }) {
    return (
      <button
        onClick={onDismiss}
        title="dismiss this marker"
        className={clsx(
          "absolute -left-4 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full",
          "bg-c-action text-[10px] font-bold leading-none text-c-dark-full transition hover:brightness-110",
          className,
        )}
      >
        ×
      </button>
    );
  }

  export function TimestampPin({ row, onDismiss }: { row: Line.TimestampPin; onDismiss: () => void }) {
    return (
      <div data-landed="" className={clsx("relative", row.pastEveryLine && "pt-3 text-[11px] text-c-dark-half")}>
        <span aria-hidden className="pointer-events-none absolute -left-4 -right-4 -top-px h-px bg-c-action" />
        <DismissButton onDismiss={onDismiss} className="-top-2" />
        {row.pastEveryLine && <span className="block text-center">nothing was logged after this</span>}
      </div>
    );
  }

  function Note({ type, children, className }: { type: Line.Type; children: ReactNode; className?: string }) {
    // named in the dom, so a note can be found by what it is rather than by what it happens to say
    return (
      <div data-row={type} className={clsx("text-c-dark-half text-center", className)}>
        {children}
      </div>
    );
  }

  export function BeginningMarker({ row }: { row: Line.BeginningMarker }) {
    return (
      <Note type={row.type} className="pb-2">
        that is the beginning
      </Note>
    );
  }

  export function MoreMarker({ row }: { row: Line.MoreMarker }) {
    // the model says which way; the wording is this file's business
    return row.direction === Direction.backwards_in_time ? (
      <Note type={row.type} className="pb-2">
        scroll up for more
      </Note>
    ) : (
      <Note type={row.type} className="pt-2">
        scroll down for more
      </Note>
    );
  }

  export function DayMarker({ row }: { row: Line.DayMarker }) {
    return (
      <div className="relative flex justify-center py-3 text-[11px] tracking-wide text-c-dark-half">
        {/* the date carries its own printing, so the row hands over the day rather than a rendering of it */}
        {row.date.toString()}
      </div>
    );
  }

  export function Line({
    row,
    onDismiss,
    onTogglePin,
    matched,
    current,
  }: {
    row: Line.Event;
    onDismiss: () => void;
    onTogglePin: () => void;
    matched: boolean;
    current: boolean;
  }) {
    const { event, pinned } = row;
    const time = event.timestamp.toString({ smallestUnit: "second" }).replace("T", " ").replace("Z", "");
    return (
      <div
        data-event={event.id}
        data-landed={pinned ? "" : undefined}
        className={clsx(
          "relative flex gap-3 whitespace-pre-wrap break-all",
          // every match is lit, faintly; the one being stepped through is lit enough to find at a glance
          matched && "-mx-1 rounded-sm px-1",
          matched && !current && "bg-yellow-400/15",
          current && "bg-yellow-400/35 ring-1 ring-yellow-400/60",
          // a pinned message is boxed rather than ruled: the mark is about *this line*, not a seam
          pinned && "-mx-1 rounded-sm px-1 ring-2 ring-c-action",
        )}
      >
        {pinned && <DismissButton onDismiss={onDismiss} className="top-1/2 -translate-y-1/2" />}
        <button
          onClick={onTogglePin}
          title={pinned ? "unpin this message" : "pin this message"}
          className={clsx(
            "shrink-0 cursor-pointer text-left transition-colors",
            pinned ? "text-c-action" : "text-gray-500 hover:text-gray-300",
          )}
        >
          {time}
        </button>
        <span className={clsx("flex-1", colour(event))}>{describe(event)}</span>
      </div>
    );
  }

  function colour(event: ContainerEvent): string {
    switch (event.type) {
      case ContainerEvent.Type.start:
        return "text-green-400";
      case ContainerEvent.Type.stop:
        return "text-red-400";
      case ContainerEvent.Type.log_throttle:
        return "text-yellow-400";
      case ContainerEvent.Type.log:
        return event.streamVariant === StreamVariant.stderr ? "text-red-300" : "";
    }
  }

  function describe(event: ContainerEvent): string {
    switch (event.type) {
      case ContainerEvent.Type.start:
        return "▲ container started";
      case ContainerEvent.Type.stop:
        return "▼ container stopped";
      case ContainerEvent.Type.log_throttle:
        return `⚡ throttled; ${event.foldCount} messages dropped`;
      case ContainerEvent.Type.log:
        return event.line;
    }
  }

  export function element(container: HTMLElement | null, eventId: string): HTMLElement | null {
    return container?.querySelector<HTMLElement>(`[data-event="${CSS.escape(eventId)}"]`) ?? null;
  }

  export function landed(container: HTMLElement | null): HTMLElement | null {
    return container?.querySelector<HTMLElement>("[data-landed]") ?? null;
  }

  function overlaps(line: HTMLElement, container: HTMLElement): boolean {
    const bounds = container.getBoundingClientRect();
    const rect = line.getBoundingClientRect();
    return rect.bottom > bounds.top && rect.top < bounds.bottom;
  }

  export function onScreen(container: HTMLElement, eventId: string): boolean {
    const line = element(container, eventId);
    return line !== null && overlaps(line, container);
  }

  export function visibleEdges(container: HTMLElement): { first?: string; last?: string } {
    const shown = [...container.querySelectorAll<HTMLElement>("[data-event]")].filter((line) => overlaps(line, container));
    return { first: shown.at(0)?.dataset.event, last: shown.at(-1)?.dataset.event };
  }
}
