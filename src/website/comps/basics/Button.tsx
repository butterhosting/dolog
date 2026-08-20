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
        "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        variant === "filled" && theme === "accent" && "bg-c-accent text-white hover:bg-c-accent/90",
        variant === "filled" && theme === "error" && "bg-c-error text-white hover:bg-c-error/90",
        variant === "filled" && theme === "neutral" && "bg-c-dark-half text-white hover:bg-c-dark-full",
        variant === "ghost" && theme === "accent" && "text-c-accent hover:bg-c-accent/5",
        variant === "ghost" && theme === "error" && "text-c-error/80 hover:text-c-error",
        variant === "ghost" && theme === "neutral" && "text-c-dark-half hover:text-c-dark-full",
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
