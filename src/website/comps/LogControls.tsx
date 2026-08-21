import { Direction } from "@/models/Direction";
import clsx from "clsx";
import { ReactNode, RefObject } from "react";

export namespace LogControls {
  const CONTROL = "h-9 rounded-lg inline-flex items-center";

  export function Field({ children }: { children: ReactNode }) {
    return <span className={clsx(CONTROL, "gap-1.5 bg-white px-2")}>{children}</span>;
  }

  export function Readout({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) {
    return (
      <button onClick={onClick} title={title} className={clsx(CONTROL, "bg-white px-3 font-mono text-xs text-c-dark-full cursor-pointer")}>
        {children}
      </button>
    );
  }

  export function RegexToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
    return (
      <button
        onClick={onClick}
        title="read this as a regular expression"
        className={clsx(
          "rounded border px-1.5 py-0.5 font-mono text-[11px] cursor-pointer transition-colors",
          on
            ? "border-c-accent bg-c-accent text-white"
            : "border-c-dark-half/40 text-c-dark-half hover:border-c-dark-full hover:text-c-dark-full",
        )}
      >
        R
      </button>
    );
  }

  export function Step({
    ref,
    direction,
    onClick,
    disabled,
    busy,
  }: {
    ref: RefObject<HTMLButtonElement | null>;
    direction: Direction;
    onClick: () => void;
    disabled: boolean;
    busy: boolean;
  }) {
    return (
      <button
        ref={ref}
        onClick={onClick}
        disabled={disabled}
        title={`${direction === Direction.backwards_in_time ? "previous" : "next"} match`}
        className={clsx(
          CONTROL,
          "w-9 justify-center bg-c-action text-c-dark-full cursor-pointer transition hover:brightness-110 disabled:opacity-25 disabled:cursor-default",
        )}
      >
        {busy ? (
          <span className="size-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <svg
            viewBox="0 0 10 6"
            className="w-2.5 fill-none stroke-current stroke-2"
            // the sole place the domain's sense of time becomes a direction on screen
            style={{ transform: direction === Direction.backwards_in_time ? "" : "rotate(180deg)" }}
          >
            <path d="M1 5 L5 1 L9 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    );
  }
}
