import clsx from "clsx";
import { useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { FindBar } from "../comps/logviewer/FindBar";
import { LogRow } from "../comps/logviewer/LogRow";
import { LogToolbar } from "../comps/logviewer/LogToolbar";
import { Spinner } from "../comps/Spinner";
import { useContainerLogs } from "../hooks/useContainerLogs";
import { useContainerName } from "../hooks/useContainerName";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useLogFilter } from "../hooks/useLogFilter";
import { useLogSearch } from "../hooks/useLogSearch";
import { Line } from "../rendering/Line";
import { Route } from "../Route";

export function containerLogsPage() {
  const { id: containerId = "" } = useParams();
  const [parameters, setParameters] = useSearchParams();

  const logFilter = useLogFilter({
    parameters,
    setParameters,
  });
  const containerLogs = useContainerLogs({
    containerId,
    activeFilter: logFilter.activeFilter,
    parameters,
    setParameters,
  });
  const logSearch = useLogSearch({
    id: containerId,
    applied: logFilter.activeFilter,
    element: containerLogs.ref,
    rendered: containerLogs.rendered,
    events: containerLogs.events,
    onFoundOutsideWindow: containerLogs.anchorToLine,
  });

  const name = useContainerName(containerId, containerLogs.events);
  useDocumentTitle(`${name} | Dolog`);

  const applyFilter = useCallback(() => {
    logFilter.formState.apply();
    if (!containerLogs.at) {
      containerLogs.returnToLiveFeed();
    }
  }, [logFilter, containerLogs]);
  return (
    <div className="full-bleed flex h-screen flex-col">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-4">
        <Link to={Route.containers()} className="absolute left-4 text-sm text-c-accent hover:underline">
          ← Containers
        </Link>
        <span className="font-bold">{name}</span>
      </header>

      <LogToolbar filter={logFilter} onApply={applyFilter} onJump={() => void containerLogs.openJumpDialog()} />

      <div className="relative flex-1 min-h-0">
        {/*
         * `overflow-anchor: none` because this list is edited at both ends and the browser's scroll
         * anchoring fights that. Trimming lines off the top made it rewind `scrollTop` to hold the
         * view still, which arrives as a scroll to somewhere far from the bottom -- and being at the
         * bottom is exactly how following is detected, so the feed latched to paused while lines
         * were still arriving. Both ends are compensated for deliberately here instead.
         */}
        <div
          ref={containerLogs.ref}
          onScroll={containerLogs.handleScroll}
          className="h-full overflow-y-auto [overflow-anchor:none] bg-c-dark-full text-gray-200 font-mono text-xs p-4 leading-relaxed"
        >
          {containerLogs.loading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {/*
           * The one thing about an empty window that `Renderer` cannot say: *why* it is empty. That
           * answer needs the filter as well as the window, so it is the page that gives it.
           */}
          {!containerLogs.loading && containerLogs.lines.length === 0 && (
            <div className="text-c-dark-half py-8 text-center">
              {logFilter.isActiveFilterNarrowing
                ? "Nothing in this container matches the filter"
                : containerLogs.anchor?.kind === "timestamp"
                  ? "Nothing was logged at or after that time"
                  : "No logs recorded yet"}
            </div>
          )}
          {containerLogs.lines.map((line) => {
            switch (line.type) {
              case Line.Type.beginning_marker:
                return <LogRow.BeginningMarker key="beginning" row={line} />;
              case Line.Type.more_marker:
                return <LogRow.MoreMarker key={`more-${line.direction}`} row={line} />;
              case Line.Type.day_marker:
                return <LogRow.DayMarker key={`day-${line.date.toString()}`} row={line} />;
              case Line.Type.timestamp_pin:
                // at most one of these exists, so it needs no key of its own
                return <LogRow.TimestampPin key="pin" row={line} onDismiss={containerLogs.dismissPin} />;
              case Line.Type.event:
                return (
                  <LogRow.Line
                    key={line.event.id}
                    row={line}
                    onDismiss={containerLogs.dismissPin}
                    onTogglePin={() => containerLogs.togglePinnedLine(line.event.id)}
                    matched={logSearch.matched.has(line.event.id)}
                    current={line.event.id === logSearch.currentMatch}
                  />
                );
            }
          })}
        </div>

        {logSearch.finding && <FindBar search={logSearch} />}

        {/* offered whenever the feed is not being followed -- scrolled up, or parked in history */}
        {!containerLogs.atLiveEnd && (
          <button
            onClick={() => void containerLogs.jumpToLive()}
            title="new lines are not being added while you read back"
            className={clsx(
              "absolute right-4 flex items-center gap-2 rounded-full bg-c-accent text-white text-xs pl-3 pr-4 py-2 shadow-lg cursor-pointer hover:opacity-90",
              // stacked above the find bar rather than under it, since both live in this corner
              logSearch.finding ? "bottom-20" : "bottom-4",
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
