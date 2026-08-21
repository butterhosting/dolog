import { RangeDisplay } from "@/helpers/RangeDisplay";
import { Pattern } from "@/models/Pattern";
import { useFilter } from "../hooks/useFilter";
import { Button } from "./basics/Button";
import { RegexToggle } from "./RegexToggle";

type Props = {
  filter: useFilter.Result;
  onApply: () => void;
  onJump: () => void;
};

export function Toolbar({ filter, onApply, onJump }: Props) {
  const { form, formState } = filter;
  const period = RangeDisplay.label(form.range);
  return (
    <div className="flex items-end gap-7 bg-c-dark-deep px-4 pb-3 pt-2">
      <Button onClick={onJump}>Jump</Button>

      <div>
        <RegexToggle active={form.patternType === Pattern.Type.regex} onClick={form.togglePatternType} />
        <input
          value={form.pattern}
          onChange={(event) => form.setPattern(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && formState.dirty && onApply()}
          placeholder="type to filter"
          className="w-72 font-mono text-xs text-c-dark-full outline-none placeholder:text-c-dark-half"
        />
      </div>
      <Button onClick={onApply} disabled={!formState.dirty}>
        Apply
      </Button>

      <div className="flex-1" />

      <Button onClick={() => void form.promptRangeDialog()} title="choose the time span this filter covers">
        {period}
      </Button>
    </div>
  );
}
