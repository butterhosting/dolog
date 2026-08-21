import { Pattern } from "@/models/Pattern";
import clsx from "clsx";
import { ComponentProps, RefObject } from "react";
import { RegexToggle } from "./RegexToggle";

type Props = Omit<ComponentProps<"input">, "type" | "value" | "onChange"> & {
  inputRef?: RefObject<HTMLInputElement | null>;
  type: Pattern.Type;
  onToggleType: () => void;
  value: string;
  onValueChange: (value: string) => void;
  invalid?: boolean;
};

/** The one light surface in the app: something to type a pattern into, with its regex flag sunk into the left. */
export function PatternField({ inputRef, type, onToggleType, value, onValueChange, invalid, className, ...props }: Props) {
  return (
    <div className={clsx("flex h-9 items-center gap-2 rounded-lg bg-c-field px-2.5", className)}>
      <RegexToggle active={type === Pattern.Type.regex} onClick={onToggleType} />
      <input
        {...props}
        ref={inputRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={clsx("min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-c-shell/45", invalid ? "text-c-error" : "text-c-shell")}
      />
    </div>
  );
}
