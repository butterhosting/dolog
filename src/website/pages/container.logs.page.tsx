import clsx from "clsx";
import { Link, useParams } from "react-router";
import { Route } from "../Route";
import { Row } from "../comps/Row";
import { SearchBox } from "../comps/SearchBox";
import { Toolbar } from "../comps/Toolbar";
import { Spinner } from "../comps/basics/Spinner";
import { useAnchor } from "../hooks/useAnchor";
import { useContainerName } from "../hooks/useContainerName";
import { useDocumentTitle } from "../hooks/basics/useDocumentTitle";
import { useFilter } from "../hooks/useFilter";
import { useLogs } from "../hooks/useLogs";
import { useLogsContainerNode } from "../hooks/useLogsContainerNode";
import { useSearch } from "../hooks/useSearch";
import { Line } from "../rendering/Line";

export function containerLogsPage() {
  const { id: containerId = "" } = useParams();
  const { register, logsContainerNode } = useLogsContainerNode();

  const anchorResult = useAnchor();
  const filterResult = useFilter();
  const logsResult = useLogs({
    containerId,
    logsContainerNode,
    anchor: anchorResult.anchor,
    filter: filterResult.filter,
  });
  const searchResult = useSearch({
    containerId,
    logsContainerNode,
    filter: filterResult.filter,
    events: logsResult.events,
    isFollowingStream: logsResult.isFollowingStream,
    navigateToUnloadedMatchResult: logsResult.navigateTo,
  });

  const name = useContainerName(containerId, logsResult.events);
  useDocumentTitle(`${name} | Dolog`);

  return (
    <div className="full-bleed flex h-screen flex-col">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-4">
        <Link to={Route.containers()} className="absolute left-4 text-sm text-c-accent hover:underline">
          ← Containers
        </Link>
        <span className="font-bold">{name}</span>
      </header>

      <Toolbar filter={filterResult} onApply={filterResult.formState.apply} onJump={() => void anchorResult.promptNavigation()} />

      <div className="relative flex-1 min-h-0">
        <div
          ref={register}
          className="h-full overflow-y-auto [overflow-anchor:none] bg-c-dark-full text-gray-200 font-mono text-xs p-4 leading-relaxed"
        >
          {logsResult.isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {!logsResult.isLoading && logsResult.lines.length === 0 && (
            <div className="text-c-dark-half py-8 text-center">
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
                    toggleAnchor={() => anchorResult.toggle(line.event.id)}
                    matched={searchResult.matching.ids.has(line.event.id)}
                    current={line.event.id === searchResult.matching.currentId}
                  />
                );
            }
          })}
        </div>

        {searchResult.activated && <SearchBox search={searchResult} />}

        {!logsResult.isFollowingStream && (
          <button
            onClick={() => logsResult.followStream()}
            title="new lines are not being added while you read back"
            className={clsx(
              "absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-c-accent text-white text-xs pl-3 pr-4 py-2 shadow-lg cursor-pointer hover:opacity-90",
            )}
          >
            <span className="rounded-full bg-yellow-400 text-c-dark-full font-bold px-2 py-0.5">paused</span>
            jump to live ↓
          </button>
        )}
      </div>
    </div>
  );
}
