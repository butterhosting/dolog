import clsx from "clsx";
import { ComponentProps } from "react";
import { Link } from "react-router";
import { useRegistry } from "../../hooks/basics/useRegistry";
import { Route } from "../../Route";
import { Paper } from "./Paper";

type Props = ComponentProps<"main">;
export function Frame(props: Props) {
  return (
    <>
      <Internal.Header />
      <Internal.Main {...props} />
      <Internal.Footer />
    </>
  );
}

namespace Internal {
  export function Header() {
    return (
      <nav className="mt-10 flex flex-wrap items-center gap-3 md:items-start">
        <Paper className="flex items-center transition-colors hover:border-c-accent">
          <Link to={Route.svcs()} className="p-4 text-lg transition-colors hover:text-c-accent">
            Services
          </Link>
        </Paper>
        <Paper className="flex items-center transition-colors hover:border-c-accent">
          <Link to={Route.svcs()} className="p-4 text-lg transition-colors hover:text-c-accent">
            Alerting
          </Link>
        </Paper>
        <Paper className="flex items-center transition-colors hover:border-c-accent">
          <Link to={Route.svcs()} className="p-4 text-lg transition-colors hover:text-c-accent">
            Configuration
          </Link>
        </Paper>
      </nav>
    );
  }

  export function Main(props: Props) {
    return <main {...props} className={clsx("mt-12 flex-1", props.className)} />;
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
