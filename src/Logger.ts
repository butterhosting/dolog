import { Temporal } from "@js-temporal/polyfill";
import { basename } from "path";
import { Env } from "./Env";
import { LogLevel } from "./models/internal/LogLevel";

export class Logger {
  private static timeZone: string;
  private static globalLogLevel: LogLevel;
  private static readonly emojis: Record<LogLevel, string> = {
    [LogLevel.debug]: "🐞",
    [LogLevel.info]: "ℹ️",
    [LogLevel.warn]: "⚠️",
    [LogLevel.error]: "❌",
  };

  public static initialize(env: Pick<Env.Private, "DOLOG_TIMEZONE" | "DOLOG_LOGGING">) {
    this.timeZone = env.DOLOG_TIMEZONE;
    this.globalLogLevel = env.DOLOG_LOGGING;
  }

  private readonly filename: string;
  private readonly initTiming: Logger.InitTiming;

  public constructor(file: string, initTiming: Logger.InitTiming = "eager") {
    this.initTiming = initTiming;
    if (initTiming === "eager") {
      this.requireInitialization();
    }
    this.filename = basename(file);
  }

  public debug = (...args: unknown[]) => {
    this.log(LogLevel.debug, ...args);
  };

  public info = (...args: unknown[]) => {
    this.log(LogLevel.info, ...args);
  };

  public warn = (...args: unknown[]) => {
    this.log(LogLevel.warn, ...args);
  };

  public error = (...args: unknown[]) => {
    this.log(LogLevel.error, ...args);
  };

  private log = (level: LogLevel, ...args: unknown[]) => {
    if (this.initTiming === "lazy") {
      this.requireInitialization();
    }
    if (this.shouldLog(level)) {
      const timestamp = Temporal.Now.plainDateTimeISO(Logger.timeZone).toString({ smallestUnit: "second" }).replace("T", " ");
      const prefix = `${timestamp} [${level.toUpperCase()}] ${Logger.emojis[level]} ${this.filename} |`;
      console[level].call(console, prefix, ...this.resolve(args));
    }
  };

  private resolve = (args: unknown[]): unknown[] => {
    if (args.length !== 1 || typeof args[0] !== "function") {
      return args;
    }
    const produced = (args[0] as Logger.Lazy)();
    return Array.isArray(produced) ? produced : [produced];
  };

  private requireInitialization = () => {
    if (!Logger.globalLogLevel) {
      throw new Error("Logger must be initialized first");
    }
  };

  private shouldLog = (level: LogLevel): boolean => {
    switch (Logger.globalLogLevel) {
      case LogLevel.debug:
        return true;
      case LogLevel.info:
        return [LogLevel.info, LogLevel.warn, LogLevel.error].includes(level);
      case LogLevel.warn:
        return [LogLevel.warn, LogLevel.error].includes(level);
      case LogLevel.error:
        return [LogLevel.error].includes(level);
    }
  };
}

export namespace Logger {
  /**
   * When to check that {@link Logger.initialize} has run. `eager` fails at construction, which is
   * what you want almost everywhere; `lazy` waits until something is actually logged, for the few
   * loggers built at module scope before the application has configured anything.
   *
   * Unrelated to {@link Logger.Lazy}, which is about deferring a message rather than a check.
   */
  export type InitTiming = "eager" | "lazy";

  /**
   * Passed on its own to any of the log methods to defer the cost of building the message:
   *
   *     log.debug(() => `parsed ${expensiveSummary(batch)}`);
   *     log.debug(() => ["parsed", expensiveSummary(batch)]);
   *
   * An array is spread as separate arguments, anything else is logged as one.
   */
  export type Lazy = () => unknown;
}
