import { Direction } from "@/models/Direction";
import { Pattern } from "@/models/Pattern";
import clsx from "clsx";
import { useSearch } from "../hooks/useSearch";
import { ChevronButton } from "./ChevronButton";
import { RegexToggle } from "./RegexToggle";

type Props = {
  search: useSearch.Result;
};
export function SearchBox({ search }: Props) {
  return (
    <div className="absolute bottom-4 right-4 flex items-center gap-1.5 rounded-xl bg-c-dark-deep p-2 shadow-2xl">
      <div>
        <RegexToggle active={search.form.needleType === Pattern.Type.regex} onClick={search.form.toggleNeedleType} />
        <input
          ref={search.form.textField}
          autoFocus
          value={search.form.needle}
          onChange={(event) => search.form.setNeedle(event.target.value)}
          onKeyDown={(event) =>
            event.key === "Enter" && void search.matching.step(event.shiftKey ? Direction.backwards_in_time : Direction.forwards_in_time)
          }
          placeholder="type to search"
          className={clsx(
            "w-56 bg-transparent font-mono text-xs outline-none placeholder:text-c-dark-half",
            search.form.isRegexInvalid ? "text-c-error" : "text-c-dark-full",
          )}
        />
      </div>
      <ChevronButton
        ref={search.matching.chevrons[Direction.backwards_in_time]}
        direction={Direction.backwards_in_time}
        onClick={() => void search.matching.step(Direction.backwards_in_time)}
        disabled={!search.form.needle}
        busy={search.matching.isSearchingRightNow === Direction.backwards_in_time}
      />
      <ChevronButton
        ref={search.matching.chevrons[Direction.forwards_in_time]}
        direction={Direction.forwards_in_time}
        onClick={() => void search.matching.step(Direction.forwards_in_time)}
        disabled={!search.form.needle}
        busy={search.matching.isSearchingRightNow === Direction.forwards_in_time}
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
