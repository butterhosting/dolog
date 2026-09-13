import { TextSize } from "@/models/TextSize";
import { usePreferences } from "./usePreferences";

export function useTextSize(): useTextSize.Result {
  const { textSize, update } = usePreferences();
  return {
    size: textSize,
    setSize: (size) => update({ textSize: size }),
    className: Internal.classes[textSize],
  };
}

namespace Internal {
  export const classes: Record<TextSize, string> = {
    s: "text-xs leading-5",
    m: "text-sm leading-6",
    l: "text-lg leading-8",
  };
}

export namespace useTextSize {
  export type Result = {
    size: TextSize;
    setSize(size: TextSize): void;
    className: string;
  };
}
