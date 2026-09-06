import clsx from "clsx";

type Props = {
  down?: boolean;
  className?: string;
};

/** Rotating it keeps the footprint, since the glyph is as wide as its box. */
export function Caret({ down, className }: Props) {
  return (
    <svg
      viewBox="0 0 22 19"
      className={clsx("w-3.5 fill-current", className)}
      style={{ transform: down ? "rotate(180deg)" : "" }}
      aria-hidden
    >
      <path d="M11 0 L22 19 L0 19 Z" />
    </svg>
  );
}
