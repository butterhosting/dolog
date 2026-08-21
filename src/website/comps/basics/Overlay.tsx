import clsx from "clsx";
import { ReactNode } from "react";

type Props = {
  className?: string;
  children: ReactNode;
};

/**
 * A ruled box floating over the logs. Drawn on the surface colour rather than left transparent, so
 * the lines it covers while you read back cannot show through the controls sitting on it.
 */
export function Overlay({ className, children }: Props) {
  return (
    <div className={clsx("absolute bottom-4 flex h-14 items-center gap-2 border border-c-rule bg-c-surface px-2.5", className)}>
      {children}
    </div>
  );
}
