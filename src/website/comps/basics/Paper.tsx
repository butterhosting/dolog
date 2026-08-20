import clsx from "clsx";
import { ComponentProps } from "react";

type Props = ComponentProps<"div"> & {
  borderClassName?: string;
};
export function Paper({ className, borderClassName, children, ...props }: Props) {
  return (
    <div className={clsx("bg-white rounded-2xl relative shadow-lg", className)} {...props}>
      {children}
    </div>
  );
}
