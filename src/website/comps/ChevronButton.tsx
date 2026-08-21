import { Direction } from "@/models/Direction";
import clsx from "clsx";
import { RefObject } from "react";

const CONTROL = "h-9 rounded-lg inline-flex items-center"; // TODO: ???

type Props = {
  ref: RefObject<HTMLButtonElement | null>;
  direction: Direction;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
};
export function ChevronButton({ ref, direction, onClick, disabled, busy }: Props) {
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
