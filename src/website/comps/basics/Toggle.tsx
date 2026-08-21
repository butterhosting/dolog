import clsx from "clsx";
import { ComponentProps } from "react";

type Props = ComponentProps<"button"> & {
  active: boolean;
  /** Which dark it wears when off -- `shell` for the one sunk into a light field, `chip` when it stands on the toolbar. */
  tone?: "shell" | "chip";
};

/** The small square switch: one glyph, on or off. Worn by the regex flag and by the text sizes. */
export function Toggle({ active, tone = "chip", className, ...props }: Props) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex size-6 shrink-0 items-center justify-center rounded border text-sm leading-none cursor-pointer transition-colors",
        active && "border-black bg-c-accent text-black",
        !active && tone === "chip" && "border-c-chip-edge bg-c-chip text-white hover:border-white",
        !active && tone === "shell" && "border-c-shell bg-c-shell text-white hover:border-c-rule",
        className,
      )}
    />
  );
}
