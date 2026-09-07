type Props = {
  direction: Caret.Direction;
  /** replaces the default size, which is a 14px base whichever way it points */
  className?: string;
};

/** A sharp triangle. Each direction is its own path, so the box is always the shape of the glyph. */
export function Caret({ direction, className }: Props) {
  const vertical = direction === "up" || direction === "down";
  return (
    <svg
      viewBox={vertical ? "0 0 22 19" : "0 0 19 22"}
      className={`${className ?? (vertical ? "w-3.5" : "h-3.5")} fill-current`}
      aria-hidden
    >
      <path d={Internal.PATHS[direction]} />
    </svg>
  );
}

export namespace Caret {
  export type Direction = "up" | "down" | "left" | "right";
}

namespace Internal {
  export const PATHS: Record<Caret.Direction, string> = {
    up: "M11 0 L22 19 L0 19 Z",
    down: "M0 0 L22 0 L11 19 Z",
    left: "M19 0 L19 22 L0 11 Z",
    right: "M0 0 L19 11 L0 22 Z",
  };
}
