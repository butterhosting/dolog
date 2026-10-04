import clsx from "clsx";

type Props = {
  part: number;
  whole: number;
  className?: string;
};
export function Bar({ part, whole, className }: Props) {
  const fraction = whole > 0 ? Math.min(1, Math.max(0, part / whole)) : 0;
  return (
    <div className={clsx("h-1 bg-c-chip", className)}>
      <div
        className={clsx("h-full", fraction > 0.9 ? "bg-c-severity-error" : fraction > 0.7 ? "bg-c-severity-warn" : "bg-c-accent")}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}
