import { Direction } from "@/models/Direction";
import { useSearch } from "../hooks/useSearch";
import { Overlay } from "./basics/Overlay";
import { ChevronButton } from "./ChevronButton";
import { PatternField } from "./PatternField";

type Props = {
  search: useSearch.Result;
};
export function LogSearchBox({ search }: Props) {
  return (
    <Overlay className="left-1/2 -translate-x-1/2">
      <PatternField
        className="w-60"
        inputRef={search.form.textField}
        autoFocus
        type={search.form.needleType}
        onToggleType={search.form.toggleNeedleType}
        value={search.form.needle}
        onValueChange={search.form.setNeedle}
        onKeyDown={(event) =>
          event.key === "Enter" && void search.matching.step(event.shiftKey ? Direction.backwards_in_time : Direction.forwards_in_time)
        }
        placeholder="Type to search"
        invalid={search.form.isRegexInvalid}
      />
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
    </Overlay>
  );
}
