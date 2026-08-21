import { useState } from "react";

// TODO: save to local storage, so the preferred size is remembered
export function useTextSize(): useTextSize.Result {
  const [size, setSize] = useState<useTextSize.Size>("m");
  return {
    size,
    setSize,
    className: Internal.CLASS_NAMES[size],
  };
}

namespace Internal {
  /** Whole class strings, since Tailwind reads these literally and cannot see one built at runtime. */
  export const CLASS_NAMES: Record<useTextSize.Size, string> = {
    s: "text-xs leading-5",
    m: "text-sm leading-6",
    l: "text-lg leading-8",
  };
}

export namespace useTextSize {
  export type Size = "s" | "m" | "l";

  export const SIZES: Size[] = ["s", "m", "l"];

  export type Result = {
    size: Size;
    setSize(size: Size): void;
    className: string;
  };
}
