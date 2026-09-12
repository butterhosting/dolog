import { Prettify } from "@/helpers/Prettify";
import clsx from "clsx";
import { ComponentProps, ReactNode } from "react";
import { NavLink } from "react-router";
import { useRegistry } from "../../hooks/basics/useRegistry";
import { Route } from "../../Route";
import { Meter } from "../Meter";
import { Cell } from "./Cell";

type Props = ComponentProps<"main"> & {
  tools?: ReactNode;
  summary?: Frame.Summary;
};
export function Frame({ tools, summary, ...props }: Props) {
  return (
    <div className="full-bleed flex min-h-screen flex-col">
      <Internal.Header tools={tools} summary={summary} />
      <Internal.Main {...props} />
      <Internal.Footer />
    </div>
  );
}

export namespace Frame {
  export type Summary = {
    running: number;
    stopped: number;
    stoppedHidden: boolean;
  };
}

namespace Internal {
  // TODO placeholders until the server reports its host -- nothing in here is measured
  const HOST = {
    hostname: "tnlap",
    dockerVersion: "v27.1.1",
    cpuUsage: 0.27,
    cpuTotal: 10,
    memoryUsage: 3 * 2 ** 30,
    memoryTotal: 32 * 2 ** 30,
  };

  type HeaderProps = Pick<Props, "tools" | "summary">;
  export function Header({ tools, summary }: HeaderProps) {
    return (
      <header className="flex h-16 shrink-0 border-b border-c-rule">
        <NavCell to={Route.svcs()}>services</NavCell>
        <NavCell to={Route.configuration()}>configuration</NavCell>
        {tools && <Cell className="gap-2 px-5">{tools}</Cell>}

        <Cell className="flex-1 flex-col justify-center gap-0.5 px-4">
          <div>
            {HOST.hostname}
            {summary && (
              <>
                {" • "}
                {summary.running} running
                {" • "}
                <span className={clsx("text-c-rule", summary.stoppedHidden && "italic")}>{summary.stopped} stopped</span>
              </>
            )}
          </div>
          <div className="text-sm text-c-rule">docker {HOST.dockerVersion}</div>
        </Cell>

        <Cell className="w-80 px-4 lg:hidden">
          <Meter label="CPU" part={HOST.cpuUsage} whole={HOST.cpuTotal} format={Prettify.cores} unit="cores" />
        </Cell>
        <Cell last className="w-80 px-4 lg:hidden">
          <Meter label="MEM" part={HOST.memoryUsage} whole={HOST.memoryTotal} format={Prettify.bytes} />
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
            clsx("flex h-full items-center bg-c-chip px-14 text-xl transition-colors hover:text-c-accent", isActive && "text-c-accent")
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
