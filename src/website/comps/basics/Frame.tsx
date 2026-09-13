import { Prettify } from "@/helpers/Prettify";
import clsx from "clsx";
import { ComponentProps, ReactNode } from "react";
import { NavLink } from "react-router";
import { useRegistry } from "../../hooks/basics/useRegistry";
import { useHost } from "../../hooks/useHost";
import { usePreferences } from "../../hooks/usePreferences";
import { useSvcs } from "../../hooks/useSvcs";
import { Route } from "../../Route";
import { Meter } from "../Meter";
import { Cell } from "./Cell";
import { EyeIcon } from "./EyeIcon";
import { Toggle } from "./Toggle";

type Props = ComponentProps<"main">;
export function Frame(props: Props) {
  return (
    <div className="full-bleed flex min-h-screen flex-col">
      <Internal.Header />
      <Internal.Main {...props} />
      <Internal.Footer />
    </div>
  );
}

namespace Internal {
  export function Header() {
    const host = useHost();
    const svcs = useSvcs();
    const { showStoppedContainers, update } = usePreferences();
    const running = svcs?.filter((svc) => svc.liveStats).length ?? 0;
    const stopped = (svcs?.length ?? 0) - running;
    return (
      <header className="flex h-16 shrink-0 border-b border-c-rule">
        <NavCell to={Route.svcs()}>services</NavCell>
        <NavCell to={Route.configuration()}>configuration</NavCell>
        <Cell className="px-5">
          <Toggle
            active={showStoppedContainers}
            onClick={() => update({ showStoppedContainers: !showStoppedContainers })}
            title={showStoppedContainers ? "hide stopped containers" : "show stopped containers"}
          >
            <EyeIcon crossed={!showStoppedContainers} />
          </Toggle>
        </Cell>

        <Cell className="flex-1 flex-col justify-center gap-0.5 px-4">
          <div>
            {host?.hostname}
            {svcs && (
              <>
                {host && " • "}
                {running} running
                {" • "}
                <span className={clsx("text-c-rule", !showStoppedContainers && "italic")}>{stopped} stopped</span>
              </>
            )}
          </div>
          <div className="text-sm text-c-rule">{host && `docker v${host.dockerVersion}`}</div>
        </Cell>

        <Cell className="w-80 px-4 lg:hidden">
          {host && <Meter label="CPU" part={host.cpuUsage} whole={host.cpuTotal} format={Prettify.cores} unit="cores" />}
        </Cell>
        <Cell last className="w-80 px-4 lg:hidden">
          {host && <Meter label="MEM" part={host.memoryUsage} whole={host.memoryTotal} format={Prettify.bytes} />}
        </Cell>
      </header>
    );
  }

  type NavCellProps = {
    to: string;
    children: ReactNode;
  };
  function NavCell({ to, children }: NavCellProps) {
    return (
      <Cell>
        <NavLink
          to={to}
          className={({ isActive }) =>
            clsx("flex h-full items-center bg-c-chip px-14 text-xl transition-colors hover:bg-black", isActive && "text-c-accent")
          }
        >
          {children}
        </NavLink>
      </Cell>
    );
  }

  export function Main(props: ComponentProps<"main">) {
    return <main {...props} className={clsx("flex-1 px-12 py-10", props.className)} />;
  }

  export function Footer() {
    const { O_DOLOG_VERSION } = useRegistry("env");
    return (
      <footer className="my-12 flex flex-col items-center gap-4">
        <div className="text-4xl font-bold text-c-accent">Dolog</div>
        <div className="-mt-3 text-c-rule">{O_DOLOG_VERSION}</div>
      </footer>
    );
  }
}
