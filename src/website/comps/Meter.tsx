import { Prettify } from "@/helpers/Prettify";
import { Bar } from "./basics/Bar";

type Props = {
  label: string;
  part: number;
  whole: number;
  format: (value: number) => string;
  unit?: string;
};
export function Meter({ label, part, whole, format, unit }: Props) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <div className="flex justify-between gap-4">
        <span>
          {label} {Prettify.percentage(part, whole)}
        </span>
        <span className="text-c-rule">
          {format(part)} / {format(whole)}
          {unit && ` ${unit}`}
        </span>
      </div>
      <Bar part={part} whole={whole} />
    </div>
  );
}
