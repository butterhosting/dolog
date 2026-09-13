import { Svc } from "@/models/Svc";
import clsx from "clsx";
import { useParams } from "react-router";
import { LogSearchBox } from "../comps/LogSearchBox";
import { Row } from "../comps/Row";
import { SvcHeader } from "../comps/SvcHeader";
import { SvcToolbar } from "../comps/SvcToolbar";
import { Button } from "../comps/basics/Button";
import { CaretIcon } from "../comps/icons/CaretIcon";
import { Overlay } from "../comps/basics/Overlay";
import { SpinnerIcon } from "../comps/icons/SpinnerIcon";
import { useDocumentTitle } from "../hooks/basics/useDocumentTitle";
import { useAnchor } from "../hooks/useAnchor";
import { useFilter } from "../hooks/useFilter";
import { useLogs } from "../hooks/useLogs";
import { useParentNode } from "../hooks/useParentNode";
import { useSearch } from "../hooks/useSearch";
import { useSvcs } from "../hooks/useSvcs";
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

  const svc = useSvcs({ id: svcId });
  const { dname, dgroup } = svc ?? Svc.decodeId(svcId);

  useDocumentTitle(`${dname} | Dolog`);

  if (!svc) {
    return (
      <div className="full-bleed flex h-screen flex-col bg-c-shell">
        <div className="flex justify-center py-24">
          <SpinnerIcon />
        </div>
      </div>
    );
  }
  return (
    <div className="full-bleed flex h-screen flex-col bg-c-shell">
      <SvcHeader
        dname={dname} //
        dgroup={dgroup}
        filter={filterResult}
      />
      <SvcToolbar
        filter={filterResult}
        textSize={textSize}
        liveStats={svc.liveStats}
        onApply={filterResult.formState.apply}
        onNavigate={() => void anchorResult.promptNavigation()}
        onSearch={() => (searchResult.activated ? searchResult.deactivate() : searchResult.activate())}
      />
      <div className="relative min-h-0 flex-1 bg-c-surface">
        <div ref={registerParentNode} className={clsx("h-full overflow-y-auto [overflow-anchor:none] px-4 py-3.5", textSize.className)}>
          {logsResult.isLoading && (
            <div className="flex justify-center py-8">
              <SpinnerIcon />
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

        {/* search box overlay */}
        {searchResult.activated && <LogSearchBox search={searchResult} />}
        {/* jump-to-live button */}
        {!logsResult.isFollowingStream && (
          <Overlay className="right-4">
            <Button onClick={() => logsResult.followStream()} title="new lines are not being added while you read back">
              <CaretIcon direction="down" />
            </Button>
          </Overlay>
        )}
      </div>
    </div>
  );
}
