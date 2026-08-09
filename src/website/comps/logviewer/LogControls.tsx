import { Direction } from "@/models/Direction";
import clsx from "clsx";
import { ReactNode, RefObject } from "react";

/**
 * The chrome around the log: the toolbar's clusters and the find bar's chevrons.
 *
 * Grouped under one namespace because the names are only meaningful together -- a bare `Field` or
 * `Group` export says nothing, and these are all one another's siblings in the same bar.
 */
export namespace LogControls {
  /**
   * One height, stated once, worn by every control in the bar. They were each sizing themselves from
   * their own padding, so a row of them came out ragged -- and stayed ragged whenever any one of them
   * gained a border or a slightly larger label.
   */
  const CONTROL = "h-9 rounded-lg inline-flex items-center";

  /** A labelled cluster of controls -- the three the toolbar is divided into. */
  export function Group({ label, children }: { label: string; children: ReactNode }) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-c-dark-half">{label}</span>
        <div className="flex items-center gap-1.5">{children}</div>
      </div>
    );
  }

  /** Reserved for controls that *do* something, which is what the colour is telling you. */
  export function Action({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className={clsx(
          CONTROL,
          "bg-c-action px-4 text-xs font-semibold text-c-dark-full cursor-pointer transition hover:brightness-110 disabled:opacity-25 disabled:cursor-default",
        )}
      >
        {children}
      </button>
    );
  }

  /** A white surface holding an input, and whatever sits beside it inside the same border. */
  export function Field({ children }: { children: ReactNode }) {
    return <span className={clsx(CONTROL, "gap-1.5 bg-white px-2")}>{children}</span>;
  }

  /** Reads like a field because it *says* something, but opens a picker rather than taking typing. */
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

  /**
   * A shake, driven from the element rather than from a class. A class would already be applied by
   * the time the second fruitless press arrived, and a css animation that is already running does
   * not restart -- so the reply to "still nothing?" would be silence.
   */
  export function nudge(element: HTMLElement | null): void {
    element?.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-2px)" }, { transform: "translateX(2px)" }, { transform: "translateX(0)" }],
      { duration: 75, iterations: 2, easing: "ease-in-out" },
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
