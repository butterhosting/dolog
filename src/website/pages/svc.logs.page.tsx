import { RangeDisplay } from "@/helpers/RangeDisplay";
import { Svc } from "@/models/Svc";
import clsx from "clsx";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Route } from "../Route";
import { Row } from "../comps/Row";
import { SearchBox } from "../comps/SearchBox";
import { Toolbar } from "../comps/Toolbar";
import { Button } from "../comps/basics/Button";
import { Caret } from "../comps/basics/Caret";
import { Overlay } from "../comps/basics/Overlay";
import { Spinner } from "../comps/basics/Spinner";
import { useDocumentTitle } from "../hooks/basics/useDocumentTitle";
import { useAnchor } from "../hooks/useAnchor";
import { useFilter } from "../hooks/useFilter";
import { useLogs } from "../hooks/useLogs";
import { useParentNode } from "../hooks/useParentNode";
import { useSearch } from "../hooks/useSearch";
import { useTextSize } from "../hooks/useTextSize";
import { Line } from "../rendering/Line";

export function svcLogsPage() {
  const { id: svcId = "" } = useParams();
  const { registerParentNode, parentNode } = useParentNode();

  const anchorResult = useAnchor();
  const filterResult = useFilter();
  const textSize = useTextSize();
  const logsResult = useLogs({
    svcId,
    parentNode,
    anchor: anchorResult.anchor,
    filter: filterResult.filter,
  });
  const searchResult = useSearch({
    svcId,
    parentNode,
    filter: filterResult.filter,
    events: logsResult.events,
    isFollowingStream: logsResult.isFollowingStream,
    navigateToUnloadedMatchResult: logsResult.navigateTo,
  });

  const { dname, dgroup } = useMemo(() => Svc.decodeId(svcId), []);
  useDocumentTitle(dgroup ? `${dname} : ${dgroup} | Dolog` : `${dname} | Dolog`);

  return (
    <div className="full-bleed flex h-screen flex-col bg-c-shell">
      <header className="relative flex h-16 shrink-0 items-center justify-center border-b border-c-rule">
        <Link to={Route.svcs()} title="back to the containers" className="absolute left-5 text-white hover:text-c-accent">
          <Internal.BackArrow />
        </Link>
        <span>
          <span className="text-base text-c-accent">{dname}</span>
          {dgroup && <span className="text-base"> : {dgroup}</span>}
        </span>
        <Button
          className="absolute right-4"
          onClick={() => void filterResult.form.promptRangeDialog()}
          title="choose the time span this filter covers"
        >
          {RangeDisplay.label(filterResult.form.range)}
        </Button>
      </header>

      <Toolbar
        filter={filterResult}
        textSize={textSize}
        onApply={filterResult.formState.apply}
        onNavigate={() => void anchorResult.promptNavigation()}
        onSearch={() => (searchResult.activated ? searchResult.deactivate() : searchResult.activate())}
      />

      <div className="relative min-h-0 flex-1 bg-c-surface">
        <div ref={registerParentNode} className={clsx("h-full overflow-y-auto [overflow-anchor:none] px-4 py-3.5", textSize.className)}>
          {logsResult.isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {!logsResult.isLoading && logsResult.lines.length === 0 && (
            <div className="py-8 text-center text-c-rule">
              {filterResult.isFilterNarrowing
                ? "Nothing in this container matches the filter"
                : anchorResult.anchor?.type === "timestamp"
                  ? "Nothing was logged at or after that time"
                  : "No logs recorded yet"}
            </div>
          )}
          {logsResult.lines.map((line) => {
            switch (line.type) {
              case Line.Type.beginning_of_time:
                return <Row.BeginningOfTime key={line.id} line={line} />;
              case Line.Type.scroll_teaser:
                return <Row.ScrollTeaser key={line.id} line={line} />;
              case Line.Type.day_transition:
                return <Row.DayTransition key={line.id} line={line} />;
              case Line.Type.timestamp_anchor:
                return <Row.TimestampAnchor key={line.id} line={line} dismiss={anchorResult.clear} />;
              case Line.Type.event:
                return (
                  <Row.Event
                    key={line.id}
                    line={line}
                    filter={filterResult.filter}
                    toggleAnchor={() => anchorResult.toggle(line.event.id)}
                    match={
                      line.event.id === searchResult.matching.currentId
                        ? "main_match"
                        : searchResult.matching.ids.has(line.event.id)
                          ? "side_match"
                          : undefined
                    }
                  />
                );
            }
          })}
        </div>

        {searchResult.activated && <SearchBox search={searchResult} />}

        {!logsResult.isFollowingStream && (
          <Overlay className="right-4">
            <Button onClick={() => logsResult.followStream()} title="new lines are not being added while you read back">
              <Caret down />
            </Button>
          </Overlay>
        )}
      </div>
    </div>
  );
}

namespace Internal {
  /** The way back. Stroked as well as filled, which is what rounds its points off. */
  export function BackArrow() {
    return (
      <svg viewBox="0 0 37 28" className="w-6 fill-current" aria-hidden>
        <path d="M32 4 L32 24 L5 14 Z" strokeWidth="7" stroke="currentColor" strokeLinejoin="round" />
      </svg>
    );
  }
}
