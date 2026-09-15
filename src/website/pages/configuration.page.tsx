import clsx from "clsx";
import { Fragment, ReactNode } from "react";
import { Frame } from "../comps/basics/Frame";
import { useDocumentTitle } from "../hooks/basics/useDocumentTitle";

export function configurationPage() {
  useDocumentTitle("Configuration | Dolog");
  return (
    <Frame padded={false} className="flex flex-col">
      <Internal.Split className="border-b border-c-rule/30" left={<Internal.Intro />} right={<Internal.Example />} />
      {Internal.TOPICS.map((topic) => (
        <Internal.Topic key={topic.title} topic={topic} />
      ))}
    </Frame>
  );
}

namespace Internal {
  type Override = {
    container: string;
    value: string;
    stopped?: boolean;
    invalid?: boolean; // the value could not be read, so the environment applies instead
  };
  type Setting = {
    title: string;
    description: string;
    defaultValue: string;
    envVar: string;
    envValue?: string;
    containerLabels?: {
      // absent for a setting that applies to the instance as a whole
      name: string;
      overrides: Override[];
    };
  };
  type Topic = {
    title: string;
    settings: Setting[];
  };

  // TODO: fake data until the backend serves the live half
  export const TOPICS: Topic[] = [
    {
      title: "system",
      settings: [
        {
          title: "timezone",
          description: "The timezone timestamps are shown in. Must be an IANA name like Europe/Amsterdam.",
          defaultValue: "UTC",
          envVar: "DOLOG_TIMEZONE",
          envValue: "Europe/Amsterdam",
        },
        {
          title: "logging",
          description: "How much Dolog writes to its own output. Must be one of debug, info, warn or error.",
          defaultValue: "info",
          envVar: "DOLOG_LOGGING",
        },
        {
          title: "docker socket",
          description: "Where Dolog reads containers and their logs from. Must be mounted into the Dolog container.",
          defaultValue: "/var/run/docker.sock",
          envVar: "DOLOG_DOCKER_SOCKET",
        },
      ],
    },
    {
      title: "throttling",
      settings: [
        {
          title: "logs per second",
          description:
            "Logs a container may write per second. Anything past that within the same second is dropped and counted, so one chatty container cannot drown out the rest. Must be a positive integer.",
          defaultValue: "100",
          envVar: "DOLOG_THROTTLE_LOGS_PER_SECOND",
          envValue: "100",
          containerLabels: {
            name: "dolog.throttle.logs-per-second",
            overrides: [
              { container: "nextcloud / nextcloud", value: "50" },
              { container: "medialib / postgres-1", value: "abc", invalid: true },
            ],
          },
        },
      ],
    },
    {
      title: "retention",
      settings: [
        {
          title: "time window",
          description:
            "How long a container's logs are kept. Older lines are pruned every few minutes. Must be a string like 30m, 24h or 180d.",
          defaultValue: "180d",
          envVar: "DOLOG_RETENTION_TIME_WINDOW",
          containerLabels: { name: "dolog.retention.time-window", overrides: [] },
        },
        {
          title: "max lines",
          description:
            "Newest lines kept per container. Once a container passes it, its oldest lines go first, whatever their age. Must be a positive integer.",
          defaultValue: "100000",
          envVar: "DOLOG_RETENTION_MAX_LINES",
          envValue: "100000",
          containerLabels: {
            name: "dolog.retention.max-lines",
            overrides: [
              { container: "nextcloud / mariadb", value: "500000" },
              { container: "(ungrouped) / worker-3", value: "1000", stopped: true },
            ],
          },
        },
      ],
    },
  ];

  type SplitProps = {
    left?: ReactNode;
    right?: ReactNode;
    className?: string;
    pad?: string;
  };
  export function Split({ left, right, className, pad = "py-10" }: SplitProps) {
    return (
      <div className={clsx("grid grid-cols-2 lg:grid-cols-1", className)}>
        <div className={clsx("px-12 lg:px-6", pad)}>{left}</div>
        <div className={clsx("border-l border-c-rule bg-c-surface px-12 lg:border-l-0 lg:px-6", pad, !right && "lg:hidden")}>{right}</div>
      </div>
    );
  }

  export function Intro() {
    return (
      <div className="flex max-w-2xl flex-col gap-4 text-c-rule">
        <p>Dolog ships with certain configuration defaults, such as timezones and internal logging levels.</p>
        <p>Certain configuration settings, like retention times, apply to running containers and can either be configured:</p>
        <ul className="list-disc list-inside">
          <li>
            <span className="text-white">globally</span>, by supplying Dolog itself with an environment variable
          </li>
          <li>
            <span className="text-white">individually</span> for a specific container, by specifying a Docker label
          </li>
        </ul>
        <p>When applicable, container labels precede over Dolog environment variables.</p>
      </div>
    );
  }

  export function Example() {
    return (
      <div className="flex flex-col gap-3">
        <Caption>example</Caption>
        <Card className="flex flex-col px-4 py-3 text-sm leading-relaxed whitespace-pre">
          <span className="text-c-rule"># base policy for every container: keep at most 20000 lines</span>
          <span>
            docker run --env <span className="text-c-accent">DOLOG_RETENTION_MAX_LINES=20000</span> dolog
          </span>
          <span>&nbsp;</span>
          <span className="text-c-rule"># override for one specific container: keep at most 10000 lines</span>
          <span>services:</span>
          <span>{"  my-container:"}</span>
          <span>{"    labels:"}</span>
          <span className="text-c-accent">{"      dolog.retention.max-lines: 10000"}</span>
        </Card>
      </div>
    );
  }

  export function Topic({ topic }: { topic: Topic }) {
    return (
      <div className="border-b border-c-rule/30">
        <Split pad="pt-10" left={<Heading yellow>{topic.title}</Heading>} />
        {topic.settings.map((setting, i) => (
          <Fragment key={setting.title}>
            {i > 0 && <Divider />}
            <Split left={<Docs setting={setting} />} right={<Live setting={setting} />} />
          </Fragment>
        ))}
      </div>
    );
  }

  function Divider() {
    return (
      <div className="relative">
        <Split pad="py-0" />
        <div className="absolute left-1/2 -translate-1/2 w-40 border-t border-c-rule/30" />
      </div>
    );
  }

  function Docs({ setting }: { setting: Setting }) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        <h3 className="text-lg">{setting.title}</h3>
        <p className="text-c-rule">
          {setting.description} Default: <span className="text-white">{setting.defaultValue}</span>
        </p>
      </div>
    );
  }

  const ROW = "grid grid-cols-[20rem_1fr] items-start";

  function Live({ setting }: { setting: Setting }) {
    return (
      <div className="flex flex-col gap-3">
        <Caption live>environment variable</Caption>
        <Card className={clsx(ROW, "px-4 py-3")}>
          <span className="text-sm text-c-rule">{setting.envVar}</span>
          {setting.envValue ?? (
            <Muted>
              unset, default: <span className="not-italic text-white">{setting.defaultValue}</span>
            </Muted>
          )}
        </Card>
        {setting.containerLabels && <Overrides containerLabels={setting.containerLabels} />}
      </div>
    );
  }

  function Overrides({ containerLabels }: { containerLabels: NonNullable<Setting["containerLabels"]> }) {
    return (
      <>
        <Caption live className="mt-3">
          docker label overrides
        </Caption>
        <Card className="flex flex-col gap-3 px-4 py-3">
          <div className={ROW}>
            <span className="text-sm text-c-rule">{containerLabels.name}</span>
            {containerLabels.overrides.length === 0 && <Muted>no overrides</Muted>}
          </div>
          {containerLabels.overrides.map((override) => (
            <div key={override.container} className={clsx(ROW, override.invalid ? "text-c-error" : override.stopped && "text-c-rule")}>
              <span className="pl-6">{override.container}</span>
              <span>{override.value}</span>
            </div>
          ))}
        </Card>
      </>
    );
  }

  function Muted({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={clsx("italic text-c-rule", className)}>{children}</span>;
  }

  function Heading({ children, yellow }: { children: ReactNode; yellow?: true }) {
    return <h2 className={clsx("text-2xl", yellow && "text-c-accent")}>{children}</h2>;
  }

  function Caption({ children, live, className }: { children: ReactNode; live?: boolean; className?: string }) {
    return (
      <span className={clsx("flex items-center gap-1.5 text-xs tracking-wide text-c-rule uppercase", className)}>
        {live && (
          <>
            <span className="size-1.5 rounded-full bg-c-accent animate-breathe" />
            <span className="text-c-accent">live</span>
          </>
        )}
        {children}
      </span>
    );
  }

  function Card({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={clsx("rounded-xl border border-c-rule/40 bg-c-chip/70", className)}>{children}</div>;
  }
}
