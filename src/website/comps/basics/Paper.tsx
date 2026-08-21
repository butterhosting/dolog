import clsx from "clsx";
import { ComponentProps } from "react";

type Props = ComponentProps<"div">;
export function Paper({ className, children, ...props }: Props) {
  return (
    <div className={clsx("relative rounded-xl border border-c-rule/40 bg-c-surface", className)} {...props}>
      {children}
    </div>
  );
}
