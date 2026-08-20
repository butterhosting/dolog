import clsx from "clsx";

type Props = {
  className?: string;
};
export function Spinner({ className }: Props) {
  return <div className={clsx("inline-block size-5 border-2 border-c-accent border-t-c-accent/0 rounded-full animate-spin", className)} />;
}
