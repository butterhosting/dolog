import clsx from "clsx";
import { ComponentProps } from "react";

type Props = ComponentProps<"button"> & {
  theme?: Button.Theme;
  variant?: Button.Variant;
  loading?: boolean;
};
export function Button({ theme = "accent", variant = "filled", loading, disabled, className, children, ...props }: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3.5 text-sm leading-none",
        "cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "filled" && theme === "accent" && "bg-c-accent text-c-shell hover:brightness-110",
        variant === "filled" && theme === "error" && "bg-c-error text-c-shell hover:brightness-110",
        variant === "filled" && theme === "neutral" && "border border-c-chip-edge bg-c-chip text-white hover:border-white",
        variant === "ghost" && theme === "accent" && "text-c-accent hover:bg-c-accent/10",
        variant === "ghost" && theme === "error" && "text-c-error hover:bg-c-error/10",
        variant === "ghost" && theme === "neutral" && "text-c-rule hover:text-white",
        className,
      )}
    >
      {loading && <span className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}
export namespace Button {
  export type Theme = "accent" | "neutral" | "error";
  export type Variant = "filled" | "ghost";
}
