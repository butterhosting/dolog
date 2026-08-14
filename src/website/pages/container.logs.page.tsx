import clsx from "clsx";
import { Fragment, useCallback } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { FindBar } from "../comps/logviewer/FindBar";
import { LogRow } from "../comps/logviewer/LogRow";
import { LogToolbar } from "../comps/logviewer/LogToolbar";
import { Spinner } from "../comps/Spinner";
import { useContainerName } from "../hooks/useContainerName";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { useLogFilter } from "../hooks/useLogFilter";
import { useLogSearch } from "../hooks/useLogSearch";
import { useVisibleLogWindow } from "../hooks/useVisibleLogWindow";
import { Route } from "../Route";

export function containerLogsPage() {
  const { id: containerId = "" } = useParams();
  const [parameters, setParameters] = useSearchParams();

  const logFilter = useLogFilter({
    parameters,
    setParameters,
  });
  const visibleLogWindow = useVisibleLogWindow({
    containerId,
    activeFilter: logFilter.activeFilter,
    activeFilterKey: logFilter.activeFilterKey,
    parameters,
    setParameters,
  });
  const logSearch = useLogSearch({
    id: containerId,
    applied: logFilter.activeFilter,
    element: visibleLogWindow.ref,
    rendered: visibleLogWindow.rendered,
    events: visibleLogWindow.events,
    onFoundOutsideWindow: visibleLogWindow.anchorToLine,
  });

  const name = useContainerName(containerId, visibleLogWindow.events);
  useDocumentTitle(`${name} | Dolog`);

  const applyFilter = useCallback(() => {
    logFilter.formState.apply();
    if (!visibleLogWindow.pinnedAt) {
      visibleLogWindow.returnToLiveFeed();
    }
  }, [logFilter, visibleLogWindow]);
  return (
    <div className="full-bleed flex h-screen flex-col">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-4">
        <Link to={Route.containers()} className="absolute left-4 text-sm text-c-accent hover:underline">
          ← Containers
        </Link>
        <span className="font-bold">{name}</span>
      </header>

      <LogToolbar filter={logFilter} onApply={applyFilter} onJump={() => void visibleLogWindow.openJumpDialog()} />

      <div className="relative flex-1 min-h-0">
        {/*
         * `overflow-anchor: none` because this list is edited at both ends and the browser's scroll
         * anchoring fights that. Trimming lines off the top made it rewind `scrollTop` to hold the
         * view still, which arrives as a scroll to somewhere far from the bottom -- and being at the
         * bottom is exactly how following is detected, so the feed latched to paused while lines
         * were still arriving. Both ends are compensated for deliberately here instead.
         */}
        <div
          ref={visibleLogWindow.ref}
          onScroll={visibleLogWindow.handleScroll}
          className="h-full overflow-y-auto [overflow-anchor:none] bg-c-dark-full text-gray-200 font-mono text-xs p-4 leading-relaxed"
        >
          {visibleLogWindow.loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <>
              {/* an empty window means something different once a time was asked for: logs may well exist, just not there */}
              {visibleLogWindow.events.length === 0 && (
                <div className="text-c-dark-half py-8 text-center">
                  {logFilter.isActiveFilterNarrowing
                    ? "Nothing in this container matches the filter"
                    : visibleLogWindow.anchor?.kind === "instant"
                      ? "Nothing was logged at or after that time"
                      : "No logs recorded yet"}
                </div>
              )}
              {visibleLogWindow.hasOlder && <div className="text-c-dark-half text-center pb-2">scroll up for more</div>}
              {!visibleLogWindow.hasOlder && visibleLogWindow.events.length > 0 && (
                <div className="text-c-dark-half text-center pb-2">that is the beginning</div>
              )}
            </>
          )}
          {visibleLogWindow.rows.map(({ event, opensDay, landedOn, pinned }) => (
            <Fragment key={event.id}>
              {opensDay && <LogRow.DayMarker date={opensDay} landedOn={landedOn === "day"} onDismiss={visibleLogWindow.dismissPin} />}
              <LogRow.Line
                event={event}
                landedOn={landedOn === "line"}
                pinned={pinned}
                onDismiss={visibleLogWindow.dismissPin}
                onTogglePin={() => visibleLogWindow.togglePinnedLine(event.id)}
                matched={logSearch.matched.has(event.id)}
                current={event.id === logSearch.currentMatch}
              />
            </Fragment>
          ))}
          {visibleLogWindow.landedAtEnd && <LogRow.TrailingMarker onDismiss={visibleLogWindow.dismissPin} />}
          {!visibleLogWindow.loading && visibleLogWindow.hasNewer && (
            <div className="text-c-dark-half text-center pt-2">scroll down for more</div>
          )}
        </div>

        {logSearch.finding && <FindBar search={logSearch} />}

        {/* offered whenever the feed is not being followed -- scrolled up, or parked in history */}
        {!visibleLogWindow.atLiveEnd && (
          <button
            onClick={() => void visibleLogWindow.jumpToLive()}
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
