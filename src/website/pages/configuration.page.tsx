import type { Env } from "@/Env";
import { Configuration } from "@/models/Configuration";
import { Svc } from "@/models/Svc";
import clsx from "clsx";
import { Fragment, ReactNode } from "react";
import { Link } from "react-router";
import { Frame } from "../comps/basics/Frame";
import { SpinnerIcon } from "../comps/icons/SpinnerIcon";
import { useDocumentTitle } from "../hooks/basics/useDocumentTitle";
import { useConfiguration } from "../hooks/useConfiguration";
import { Route } from "../Route";

export function configurationPage() {
  useDocumentTitle("Configuration | Dolog");
  const configuration = useConfiguration();

  if (!configuration) {
    return (
      <Frame>
        <div className="flex justify-center py-24">
          <SpinnerIcon />
        </div>
      </Frame>
    );
  }
  return (
    <Frame padded={false} className="flex flex-col">
      <Internal.Split className="border-b border-c-rule/30" left={<Internal.Intro />} right={<Internal.Example />} />
      {Internal.topics(configuration).map((topic, index, { length: total }) => (
        <Internal.Topic key={topic.title} topic={topic} isLast={index + 1 === total} />
      ))}
    </Frame>
  );
}

namespace Internal {
  type Docs = {
    topic: string;
    title?: string;
    description: ReactNode;
  };
  const DOCS: Record<Configuration.EnvVar, Docs> = {
    DOLOG_TIMEZONE: {
      topic: "system",
      title: "timezone",
      description: "The timezone timestamps are shown in. Must be an IANA name like Europe/Amsterdam.",
    },
    DOLOG_LOGGING: {
      topic: "system",
      title: "logging",
      description: "How much Dolog writes to its own output. Must be one of debug, info, warn or error.",
    },
    DOLOG_DOCKER_SOCKET: {
      topic: "system",
      title: "docker socket",
      description: "Where Dolog reads containers and their logs from. Must be mounted into the Dolog container.",
    },
    DOLOG_RETENTION_TIME_WINDOW: {
      topic: "retention",
      title: "time window",
      description:
        "How long a container's logs are kept. Older lines are pruned every few minutes. Must be a string like 30m, 24h or 180d.",
    },
    DOLOG_RETENTION_MAX_LINES: {
      topic: "retention",
      title: "max lines",
      description:
        "Newest lines kept per container. Once a container passes it, its oldest lines go first, whatever their age. Must be a positive integer.",
    },
    DOLOG_THROTTLING_LOGS_PER_SECOND: {
      topic: "throttling",
      title: "logs per second",
      description:
        "Logs a container may write per second. Anything past that within the same second is dropped and counted, so one chatty container cannot drown out the rest. Must be a positive integer.",
    },
    DOLOG_WEBHOOKS: {
      topic: "webhooks",
      description: (
        <>
          <p>
            Defines named endpoints where alerts will be sent as POST requests. For example:{" "}
            <span className="text-white">"app_alerts=https://app.com/alerts"</span>
          </p>
          <p className="mt-4">
            When a provided webhook endpoint contains credentials in its URL, those will be sent along as basic auth. For example:{" "}
            <span className="text-white">"app_alerts=https://username:password@app.com/alerts"</span>
          </p>
          <p className="mt-4">
            In order to specify multiple webhooks, separate them by any number of whitespace characters. For example:{" "}
            <span className="text-white">"app_alerts=https://app.com/alerts db_alerts=https://db.com/alerts"</span>
          </p>
        </>
      ),
    },
    DOLOG_ALERTING_WEBHOOK_REF: {
      topic: "alerting",
      title: "webhook ref",
      description: `The name of the webhook where container alerts will be sent. Also see ${"DOLOG_WEBHOOKS" satisfies Env.Defaultable}`,
    },
    DOLOG_ALERTING_TEXT_PATTERN: {
      topic: "alerting",
      title: "text pattern",
      description:
        "A regular expression. A log line matching it raises an alert, sent to the webhook above. Leaving it empty raises no text alerts.",
    },
    DOLOG_ALERTING_THROUGHPUT_THRESHOLD: {
      topic: "alerting",
      title: "throughput threshold",
      description:
        "Logs per second above which an alert is raised, counted per second like the throttle and including dropped lines. Must be a positive integer; leaving it empty raises no throughput alerts.",
    },
    DOLOG_ALERTING_COOLDOWN_WINDOW: {
      topic: "alerting",
      title: "cooldown window",
      description:
        "Quiet time per container after an alert, so a log storm sends one message rather than a thousand. Must be a string like 30s, 5m or 1h.",
    },
  };

  type Entry = {
    docs: Docs;
    setting: Configuration.Setting;
  };
  type Topic = {
    title: string;
    entries: Entry[];
  };
  export function topics(configuration: Configuration): Topic[] {
    const topics: Topic[] = [];
    for (const [envVar, docs] of Object.entries(DOCS) as Array<[Configuration.EnvVar, Docs]>) {
      const setting = configuration.settings.find((setting) => setting.envVar === envVar);
      if (!setting) {
        continue;
      }
      const topic = topics.find((topic) => topic.title === docs.topic) ?? topics[topics.push({ title: docs.topic, entries: [] }) - 1];
      topic.entries.push({ docs, setting });
    }
    return topics;
  }

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
        <p>Specific container labels precede over Dolog environment variables.</p>
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

  export function Topic({ topic, isLast }: { topic: Topic; isLast: boolean }) {
    return (
      <div className={clsx("border-b", isLast ? "border-c-rule" : "border-c-rule/30")}>
        <Split pad="pt-10" left={<Heading yellow>{topic.title}</Heading>} />
        {topic.entries.map((entry, i) => (
          <Fragment key={entry.setting.envVar}>
            {i > 0 && <Divider />}
            <Split left={<Docs entry={entry} />} right={<Live setting={entry.setting} />} />
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

  function Docs({ entry: { docs, setting } }: { entry: Entry }) {
    return (
      <div className="flex max-w-2xl flex-col gap-3">
        {docs.title && <h3 className="text-lg">{docs.title}</h3>}
        {/* a div, since a description may bring paragraphs of its own */}
        <div className="text-c-rule">
          {docs.description}
          {setting.defaultValue && (
            <>
              {" "}
              Default: <Value value={setting.defaultValue} />
            </>
          )}
        </div>
      </div>
    );
  }

  const ROW = "grid grid-cols-[24rem_1fr] items-start";

  function Live({ setting }: { setting: Configuration.Setting }) {
    return (
      <div className="flex flex-col gap-3">
        <Caption accentText="global setting">- env variable</Caption>
        <Card className={clsx(ROW, "px-4 py-3")}>
          <span className="text-sm text-c-rule">{setting.envVar}</span>
          {setting.envValue !== undefined ? (
            <span className="whitespace-pre-line break-all">{setting.envValue}</span>
          ) : (
            <Muted>
              <Value value={setting.defaultValue} /> {setting.defaultValue && "(using default)"}
            </Muted>
          )}
        </Card>
        {setting.containerLabel && <Overrides label={setting.containerLabel} />}
      </div>
    );
  }

  function Overrides({ label }: { label: NonNullable<Configuration.Setting["containerLabel"]> }) {
    return (
      <>
        <Caption accentText="container overrides" className="mt-5">
          - detected docker labels
        </Caption>
        <Card className="flex flex-col gap-3 px-4 py-3 border-l-c-accent!">
          <div className={ROW}>
            <span className="text-c-rule">{label.name}</span>
            {label.overrides.length === 0 && <Muted>(no labels detected)</Muted>}
          </div>
          {label.overrides.map((override) => (
            <div key={Svc.encodeId(override)} className={clsx(ROW, !override.valid ? "text-c-error" : override.stopped && "text-c-rule")}>
              <Link to={Route.svcsLogs(Svc.encodeId(override))} className="pl-6 text-c-accent">
                {override.dgroup ?? "(ungrouped)"} / {override.dname}
              </Link>
              <span>{override.value || <Muted>(empty)</Muted>}</span>
            </div>
          ))}
        </Card>
      </>
    );
  }

  function Value({ value }: { value: string }) {
    return value ? <span className="not-italic text-white">{value}</span> : <Muted>(none)</Muted>;
  }

  function Muted({ children }: { children: ReactNode }) {
    return <span className="italic text-c-rule">{children}</span>;
  }

  function Heading({ children, yellow }: { children: ReactNode; yellow?: true }) {
    return <h2 className={clsx("text-2xl", yellow && "text-c-accent")}>{children}</h2>;
  }

  function Caption({ children, accentText, className }: { children: ReactNode; accentText?: string; className?: string }) {
    return (
      <span className={clsx("flex items-center gap-1.5 text-sm tracking-wide text-c-rule uppercase", className)}>
        {accentText && (
          <>
            <span className="size-1.5 rounded-full bg-c-accent animate-breathe" />
            <span className="text-c-accent">{accentText}</span>
          </>
        )}
        {children}
      </span>
    );
  }

  // the surface is already black here, so a card needs its own step up
  function Card({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={clsx("rounded-xl border border-c-rule/40 bg-c-chip/70", className)}>{children}</div>;
  }
}
