export enum Severity {
  trace = "trace",
  debug = "debug",
  info = "info",
  warn = "warn",
  error = "error",
  fatal = "fatal",
}

export namespace Severity {
  // tiers run from most to least telling; two levels within one tier is ambiguous, and unmarked beats marked wrong
  export function guess(line: string): Severity | undefined {
    const text = line.replace(Internal.ANSI, "").replace(Internal.LEADING_TIMESTAMP, "");
    for (const structured of [Internal.fromJson(text), Internal.fromLogfmt(text)]) {
      if (structured !== undefined) return structured ?? undefined;
    }
    for (const tier of Internal.TIERS) {
      let found: Severity | undefined;
      for (const { regex, single } of tier) {
        for (const [, alias] of text.matchAll(regex)) {
          const level = single ? Internal.SINGLE_LETTERS[alias] : Internal.ALIASES.get(alias.toLowerCase());
          if (!level) continue;
          if (found && found !== level) return undefined;
          found = level;
        }
      }
      if (found) return found;
    }
    return undefined;
  }
}

namespace Internal {
  export const ALIASES = new Map<string, Severity>(
    Object.entries({
      [Severity.error]: ["error", "err", "fail"],
      [Severity.warn]: ["warn", "warning", "wrn"],
      [Severity.info]: ["info", "inf", "information"],
      [Severity.debug]: ["debug", "dbg", "dbug"],
      [Severity.trace]: ["trace", "trce", "verbose", "ver", "vbs"],
      [Severity.fatal]: ["fatal", "sev", "severe", "crit", "critical"],
    }).flatMap(([level, aliases]) => aliases.map((alias) => [alias, level as Severity] as const)),
  );

  export const SINGLE_LETTERS: Record<string, Severity> = {
    E: Severity.error,
    W: Severity.warn,
    I: Severity.info,
    D: Severity.debug,
    T: Severity.trace,
    F: Severity.fatal,
    V: Severity.trace,
  };

  // longest first, so "warning" is taken whole rather than as "warn" plus a stray "ing"
  const joined = [...ALIASES.keys()].sort((a, b) => b.length - a.length).join("|");
  const upper = joined.toUpperCase();

  export const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
  export const LEADING_TIMESTAMP =
    /^\d{4}[-/]\d{2}[-/]\d{2}(?:[T ](?:\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?|\d{2}:\d{2}(?:AM|PM)))?\s+/;

  type Matcher = { regex: RegExp; single?: boolean };
  export const TIERS: Matcher[][] = [
    [
      // ERROR: ..., INF ...
      { regex: new RegExp(`^(${joined})[^a-z]`, "gi") },
      // klog: E0806 14:55:55.980915 ...
      { regex: /^([EWIDFTV])\d{4} \d{2}:\d{2}:\d{2}\.\d{6}/g, single: true },
      // serilog: [09:58:00 ERR] ...
      { regex: new RegExp(`^\\[[^\\]]*\\d\\s+(${joined})\\s*\\]`, "gi") },
    ],
    [{ regex: new RegExp(`\\[ ?(${joined}) ?\\]`, "gi") }, { regex: /\[([EWIDFTV])\]/g, single: true }],
    // signale/consola: › ℹ  info  started
    [{ regex: new RegExp(`\\u203a[^a-z]*(${joined})(?:[^a-z]|$)`, "gi") }],
    // Zigbee2MQTT:info, ::INFO::
    [{ regex: new RegExp(`:(${joined})(?:[^a-z]|$)`, "gi") }],
    [{ regex: new RegExp(`"(${upper})"`, "g") }],
    [{ regex: new RegExp(` (${joined})[/|:-]`, "gi") }],
    [{ regex: new RegExp(`\\s(${upper})\\s`, "g") }],
  ];

  const JSON_KEYS = ["@l", "level", "log.level", "severity", "severityText"];
  const PINO_LEVELS: Record<number, Severity> = {
    10: Severity.trace,
    20: Severity.debug,
    30: Severity.info,
    40: Severity.warn,
    50: Severity.error,
    60: Severity.fatal,
  };

  // null: there is a level key, but nothing it says is a level, so the text tiers must not guess past it
  export function fromJson(text: string): Severity | null | undefined {
    if (!text.startsWith("{") || !text.trimEnd().endsWith("}")) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null) return undefined;
    for (const key of JSON_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string") return ALIASES.get(value.toLowerCase()) ?? null;
      if (typeof value === "number" && key === "level") return PINO_LEVELS[value] ?? null;
    }
    return undefined;
  }

  // logrus, slog and go-kit print `level=info`
  const LOGFMT = /(?:^|\s)(?:level|lvl|severity)="?(\w+)/i;

  export function fromLogfmt(text: string): Severity | null | undefined {
    const alias = text.match(LOGFMT)?.[1];
    return alias === undefined ? undefined : (ALIASES.get(alias.toLowerCase()) ?? null);
  }
}
