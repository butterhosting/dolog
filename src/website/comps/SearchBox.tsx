import { Direction } from "@/models/Direction";
import { Pattern } from "@/models/Pattern";
import clsx from "clsx";
import { useSearch } from "../hooks/useSearch";
import { LogControls } from "./LogControls";

type Props = {
  search: useSearch.Result;
};

/**
 * Find rides over the log rather than sitting in the toolbar: it is a thing you reach for mid-read
 * and dismiss, not a setting the view is configured with. The filter is the opposite, which is why
 * only one of them is up there.
 */
export function SearchBox({ search }: Props) {
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-xl bg-c-dark-deep p-2 shadow-2xl">
      <LogControls.Field>
        <LogControls.RegexToggle on={search.needleType === Pattern.Type.regex} onClick={search.toggleNeedleType} />
        <input
          ref={search.textField}
          autoFocus
          value={search.needle}
          onChange={(event) => search.setNeedle(event.target.value)}
          onKeyDown={(event) =>
            event.key === "Enter" && void search.step(event.shiftKey ? Direction.backwards_in_time : Direction.forwards_in_time)
          }
          placeholder="type to search"
          className={clsx(
            "w-56 bg-transparent font-mono text-xs outline-none placeholder:text-c-dark-half",
            search.isRegexInvalid ? "text-c-error" : "text-c-dark-full",
          )}
        />
      </LogControls.Field>
      {/* never disabled by a verdict: without all of history in hand, "no more" is only ever
          true of the search we last ran, not of the one about to be run */}
      <LogControls.Step
        ref={search.chevrons[Direction.backwards_in_time]}
        direction={Direction.backwards_in_time}
        onClick={() => void search.step(Direction.backwards_in_time)}
        disabled={!search.needle.trim()}
        busy={search.searchDirection === Direction.backwards_in_time}
      />
      <LogControls.Step
        ref={search.chevrons[Direction.forwards_in_time]}
        direction={Direction.forwards_in_time}
        onClick={() => void search.step(Direction.forwards_in_time)}
        disabled={!search.needle.trim()}
        busy={search.searchDirection === Direction.forwards_in_time}
      />
      <button
        onClick={search.deactivate}
        title="close (esc)"
        className="px-1.5 text-sm text-c-dark-half cursor-pointer hover:text-gray-200"
      >
        ×
      </button>
    </div>
  );
}
