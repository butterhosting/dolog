import { Direction } from "@/models/Direction";
import { RefObject } from "react";
import { Caret } from "./basics/Caret";

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
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-c-accent text-c-shell cursor-pointer transition hover:brightness-110 disabled:opacity-50 disabled:cursor-default"
    >
      {busy ? (
        <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        // the sole place the domain's sense of time becomes a direction on screen
        <Caret direction={direction === Direction.forwards_in_time ? "down" : "up"} />
      )}
    </button>
  );
}
