import clsx from "clsx";
import { Link, useParams } from "react-router";
import { SearchBox } from "../comps/SearchBox";
import { Row } from "../comps/Row";
import { Spinner } from "../comps/basics/Spinner";
import { useContainerLogs } from "../hooks/useContainerLogs";
import { useContainerName } from "../hooks/useContainerName";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useLogAnchor } from "../hooks/useLogAnchor";
import { useLogFilter } from "../hooks/useLogFilter";
import { useLogSearch } from "../hooks/useLogSearch";
import { useScrollManager } from "../hooks/useScrollManager";
import { Line } from "../rendering/Line";
import { Route } from "../Route";
import { Toolbar } from "../comps/Toolbar";

export function containerLogsPage() {
  const { id: containerId = "" } = useParams();

  const logFilter = useLogFilter();
  const logAnchor = useLogAnchor();
  const scrollManager = useScrollManager();
  const containerLogs = useContainerLogs({
    containerId,
    filter: logFilter.filter,
    anchor: logAnchor.anchor,
    scrollManager,
  });
  const logSearch = useLogSearch({
    containerId,
    filter: logFilter.filter,
    scrollManager,
    events: containerLogs.events,
    onFoundOutsideWindow: containerLogs.moveWindowToEvent,
  });

  const name = useContainerName(containerId, containerLogs.events);
  useDocumentTitle(`${name} | Dolog`);

  return (
    <div className="full-bleed flex h-screen flex-col">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-4">
        <Link to={Route.containers()} className="absolute left-4 text-sm text-c-accent hover:underline">
          ← Containers
        </Link>
        <span className="font-bold">{name}</span>
      </header>

      <Toolbar filter={logFilter} onApply={logFilter.formState.apply} onJump={() => void logAnchor.promptNavigation()} />

      <div className="relative flex-1 min-h-0">
        {/*
         * `overflow-anchor: none` because this list is edited at both ends and the browser's scroll
         * anchoring fights that. Trimming lines off the top made it rewind `scrollTop` to hold the
         * view still, which arrives as a scroll to somewhere far from the bottom -- and being at the
         * bottom is exactly how following is detected, so the feed latched to paused while lines
         * were still arriving. Both ends are compensated for deliberately here instead.
         */}
        <div
          ref={scrollManager.registerContainer}
          className="h-full overflow-y-auto [overflow-anchor:none] bg-c-dark-full text-gray-200 font-mono text-xs p-4 leading-relaxed"
        >
          {containerLogs.isLoading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {/*
           * The one thing about an empty window that `Renderer` cannot say: *why* it is empty. That
           * answer needs the filter as well as the window, so it is the page that gives it.
           */}
          {!containerLogs.isLoading && containerLogs.lines.length === 0 && (
            <div className="text-c-dark-half py-8 text-center">
              {logFilter.isFilterNarrowing
                ? "Nothing in this container matches the filter"
                : logAnchor.anchor?.type === "timestamp"
                  ? "Nothing was logged at or after that time"
                  : "No logs recorded yet"}
            </div>
          )}
          {containerLogs.lines.map((line) => {
            switch (line.type) {
              case Line.Type.beginning_of_time:
                return <Row.BeginningOfTime key={line.id} line={line} />;
              case Line.Type.scroll_teaser:
                return <Row.ScrollTeaser key={line.id} line={line} />;
              case Line.Type.day_transition:
                return <Row.DayTransition key={line.id} line={line} />;
              case Line.Type.timestamp_anchor:
                return <Row.TimestampAnchor key={line.id} line={line} dismiss={logAnchor.clear} />;
              case Line.Type.event:
                return (
                  <Row.Event
                    key={line.id}
                    line={line}
                    toggleAnchor={() => logAnchor.toggle(line.event.id)}
                    matched={logSearch.matched.has(line.event.id)}
                    current={line.event.id === logSearch.currentMatch}
                  />
                );
            }
          })}
        </div>

        {logSearch.finding && <SearchBox search={logSearch} />}

        {/* offered whenever the feed is not being followed -- scrolled up, or parked in history */}
        {!containerLogs.isFollowingStream && (
          <button
            onClick={() => containerLogs.followStream()}
            title="new lines are not being added while you read back"
            className={clsx(
              // `bottom-4` is load-bearing: without a vertical offset an absolute element falls back
              // to its static position, which is *below* the log container rather than over it
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
