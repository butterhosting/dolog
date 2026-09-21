import { RangeDisplay } from "@/helpers/RangeDisplay";
import { Link } from "react-router";
import { useRegistry } from "../hooks/basics/useRegistry";
import { useFilter } from "../hooks/useFilter";
import { Route } from "../Route";
import { Button } from "./basics/Button";
import { CaretIcon } from "./icons/CaretIcon";

type Props = {
  dname: string;
  dgroup?: string;
  dimage?: string;
  filter: useFilter.Result;
};
export function SvcHeader({ dname, dgroup, dimage, filter }: Props) {
  const { DOLOG_TIMEZONE } = useRegistry("env");
  return (
    <header className="relative flex h-16 shrink-0 items-center justify-center border-b border-c-rule">
      <Link to={Route.svcs()} title="back to the containers" className="absolute left-5 text-white hover:text-c-accent">
        <CaretIcon direction="left" className="my-5 mx-2 h-5" />
      </Link>
      <div className="flex flex-col items-center">
        <div>
          {dgroup && <span className="text-sm text-c-rule">{dgroup} / </span>}
          <span className="text-base text-c-accent">{dname}</span>
        </div>
        <span className="text-xs text-c-rule/50">{dimage ?? " "}</span>
      </div>
      <Button
        className="absolute right-4"
        onClick={() => void filter.form.promptRangeDialog()}
        title={`choose the time span this filter covers (${DOLOG_TIMEZONE})`}
      >
        {RangeDisplay.label(filter.form.range, DOLOG_TIMEZONE)}
      </Button>
    </header>
  );
}
