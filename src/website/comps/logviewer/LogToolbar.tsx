import { LogPattern } from "@/models/LogPattern";
import { useLogFilter } from "../../hooks/useLogFilter";
import { LogRange } from "../../models/LogRange";
import { LogControls } from "./LogControls";

type Props = {
  filter: useLogFilter.Result;
  /** Applying is the page's to do, because it moves the window as well as changing the url. */
  onApply: () => void;
  onJump: () => void;
};

/**
 * The bar above the log. It sits a shade below the log surface rather than on it, so the two read as
 * separate planes -- one you act on, one you read.
 *
 * Takes the whole filter rather than a dozen props: every control here is one face of it, and
 * spelling them out one by one would only put a second copy of its shape in the middle.
 */
export function LogToolbar({ filter, onApply, onJump }: Props) {
  const { form, formState } = filter;
  const period = LogRange.label(form.range);
  return (
    <div className="flex items-end gap-7 bg-c-dark-deep px-4 pb-3 pt-2">
      <LogControls.Group label="Navigate">
        <LogControls.Action onClick={onJump}>Jump</LogControls.Action>
      </LogControls.Group>

      <LogControls.Group label="Filter">
        <LogControls.Field>
          <LogControls.RegexToggle on={form.variant === LogPattern.Variant.regex} onClick={form.toggleVariant} />
          <input
            value={form.pattern}
            onChange={(event) => form.setPattern(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && formState.dirty && onApply()}
            placeholder="type to filter"
            className="w-72 bg-transparent font-mono text-xs text-c-dark-full outline-none placeholder:text-c-dark-half"
          />
        </LogControls.Field>
        <LogControls.Action onClick={onApply} disabled={!formState.dirty}>
          Apply
        </LogControls.Action>
      </LogControls.Group>

      <div className="flex-1" />

      <LogControls.Group label="Period">
        {/* the whole span is one control: it says what is covered, and opens the picker */}
        <LogControls.Readout onClick={() => void form.promptRangeDialog()} title="choose the time span this filter covers">
          {period}
        </LogControls.Readout>
      </LogControls.Group>
    </div>
  );
}
