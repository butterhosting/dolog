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
import { useLogWindow } from "../hooks/useLogWindow";
import { Route } from "../Route";

/**
 * The log viewer, which is four concerns wired together rather than one: what the window holds
 * (`useLogWindow`), what narrows it (`useLogFilter`), what steps through it (`useLogSearch`), and
 * what to call it (`useContainerName`). They meet only here, and only at the seams below.
 *
 * The page claims the whole viewport via `full-bleed` rather than wrapping itself in `<Frame>` --
 * see `index.css` for why.
 */
export function containerLogsPage() {
  const { id = "" } = useParams();
  /** Where the marker is drawn, kept in the URL so the view can be linked and reloaded. */
  const [parameters, setParameters] = useSearchParams();
  const pinnedAt = parameters.get("at");

  const filter = useLogFilter({ parameters, setParameters, pinnedAt });
  const logWindow = useLogWindow({ id, applied: filter.applied, filterKey: filter.key, pinnedAt, setParameters });
  const search = useLogSearch({
    id,
    applied: filter.applied,
    element: logWindow.ref,
    rendered: logWindow.rendered,
    events: logWindow.events,
    onFoundOutsideWindow: logWindow.anchorToLine,
  });

  const name = useContainerName(id, logWindow.events);
  useDocumentTitle(`${name} | Dolog`);

  /**
   * A filter re-defines what the window *is*, but not where the reader is standing in it. A marker
   * is a place they chose deliberately, so changing what is shown keeps it and re-opens the window
   * around it; only jumping, or going live, moves it. With no marker there is nowhere to return to,
   * so the view starts again at the live end of the narrowed log -- which is the one part of
   * applying a filter that belongs to the window rather than to the filter.
   */
  const applyFilter = useCallback(() => {
    filter.apply();
    if (!pinnedAt) {
      logWindow.returnToLiveFeed();
    }
  }, [filter, pinnedAt, logWindow]);

  return (
    <div className="full-bleed flex h-screen flex-col">
      <header className="relative flex items-center justify-center px-4 pb-3 pt-4">
        <Link to={Route.containers()} className="absolute left-4 text-sm text-c-accent hover:underline">
          ← Containers
        </Link>
        <span className="font-bold">{name}</span>
      </header>

      <LogToolbar filter={filter} onApply={applyFilter} onJump={() => void logWindow.openJump()} />

      <div className="relative flex-1 min-h-0">
        {/*
         * `overflow-anchor: none` because this list is edited at both ends and the browser's scroll
         * anchoring fights that. Trimming lines off the top made it rewind `scrollTop` to hold the
         * view still, which arrives as a scroll to somewhere far from the bottom -- and being at the
         * bottom is exactly how following is detected, so the feed latched to paused while lines
         * were still arriving. Both ends are compensated for deliberately here instead.
         */}
        <div
          ref={logWindow.ref}
          onScroll={logWindow.handleScroll}
          className="h-full overflow-y-auto [overflow-anchor:none] bg-c-dark-full text-gray-200 font-mono text-xs p-4 leading-relaxed"
        >
          {logWindow.loading && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
          {/* an empty window means something different once a time was asked for: logs may well exist, just not there */}
          {!logWindow.loading && logWindow.events.length === 0 && (
            <div className="text-c-dark-half py-8 text-center">
              {filter.narrows
                ? "Nothing in this container matches the filter"
                : logWindow.anchor?.kind === "instant"
                  ? "Nothing was logged at or after that time"
                  : "No logs recorded yet"}
            </div>
          )}
          {!logWindow.loading && logWindow.hasOlder && <div className="text-c-dark-half text-center pb-2">scroll up for more</div>}
          {!logWindow.loading && !logWindow.hasOlder && logWindow.events.length > 0 && (
            <div className="text-c-dark-half text-center pb-2">that is the beginning</div>
          )}
          {logWindow.rows.map(({ event, opensDay, landedOn }) => (
            <Fragment key={event.id}>
              {opensDay && <LogRow.DayMarker date={opensDay} landedOn={landedOn === "day"} onDismiss={logWindow.dismissPin} />}
              <LogRow.Line
                event={event}
                landedOn={landedOn === "line"}
                onDismiss={logWindow.dismissPin}
                matched={search.matched.has(event.id)}
                current={event.id === search.currentMatch}
              />
            </Fragment>
          ))}
          {logWindow.landedAtEnd && <LogRow.TrailingMarker onDismiss={logWindow.dismissPin} />}
          {!logWindow.loading && logWindow.hasNewer && <div className="text-c-dark-half text-center pt-2">scroll down for more</div>}
        </div>

        {search.finding && <FindBar search={search} />}

        {/* offered whenever the feed is not being followed -- scrolled up, or parked in history */}
        {!logWindow.atLiveEnd && (
          <button
            onClick={() => void logWindow.jumpToLive()}
            title="new lines are not being added while you read back"
            className={clsx(
              "absolute right-4 flex items-center gap-2 rounded-full bg-c-accent text-white text-xs pl-3 pr-4 py-2 shadow-lg cursor-pointer hover:opacity-90",
              // stacked above the find bar rather than under it, since both live in this corner
              search.finding ? "bottom-20" : "bottom-4",
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
