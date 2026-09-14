import { Svc } from "@/models/Svc";
import clsx from "clsx";
import { Frame } from "../comps/basics/Frame";
import { Paper } from "../comps/basics/Paper";
import { SpinnerIcon } from "../comps/icons/SpinnerIcon";
import { SvcCard } from "../comps/SvcCard";
import { useDocumentTitle } from "../hooks/basics/useDocumentTitle";
import { usePreferences } from "../hooks/usePreferences";
import { useSvcs } from "../hooks/useSvcs";

export function svcsPage() {
  useDocumentTitle("Services | Dolog");
  const svcs = useSvcs();
  const { hideStoppedSvcs } = usePreferences();

  if (!svcs) {
    return (
      <Frame>
        <div className="flex justify-center py-24">
          <SpinnerIcon />
        </div>
      </Frame>
    );
  }
  const groups = Internal.group(hideStoppedSvcs ? svcs.filter((svc) => svc.liveStats) : svcs);
  return (
    <Frame className="flex flex-col gap-12">
      {groups.length === 0 && (
        <Paper className="px-6 py-12 text-center">
          <span className="text-sm tracking-wide text-c-rule">{svcs.length === 0 ? "NO CONTAINERS" : "NOTHING RUNNING"}</span>
        </Paper>
      )}
      {groups.map(({ name, svcs }) => (
        <section key={name ?? ""} className="flex flex-col gap-4">
          <h2 className={clsx("text-2xl", !name && "italic text-c-rule")}>{name ?? "(ungrouped)"}</h2>
          <div className="flex flex-wrap gap-6">
            {svcs.map((svc) => (
              <SvcCard key={svc.id} svc={svc} />
            ))}
          </div>
        </section>
      ))}
    </Frame>
  );
}

namespace Internal {
  type Group = {
    name?: string;
    svcs: Svc[];
  };
  /** Groups by name with the nameless one last; containers by name within each. */
  export function group(svcs: Svc[]): Group[] {
    const byName = new Map<string | undefined, Svc[]>();
    for (const svc of svcs) {
      byName.set(svc.dgroup, [...(byName.get(svc.dgroup) ?? []), svc]);
    }
    return [...byName.entries()]
      .map(([name, members]) => ({ name, svcs: [...members].sort((a, b) => a.dname.localeCompare(b.dname)) }))
      .sort((a, b) => (a.name === undefined ? 1 : b.name === undefined ? -1 : a.name.localeCompare(b.name)));
  }
}
