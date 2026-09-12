import clsx from "clsx";
import { ReactNode } from "react";

type Props = {
  className?: string;
  last?: boolean;
  children?: ReactNode;
};
export function Cell({ className, last, children }: Props) {
  return <div className={clsx("flex h-full items-center", !last && "border-r border-c-rule", className)}>{children}</div>;
}
