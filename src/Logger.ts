import { Temporal } from "@js-temporal/polyfill";
import { basename } from "path";
import { Env } from "./Env";
import { LogLevel } from "./models/LogLevel";

export class Logger {
  private static timeZone: string;
  private static globalLogLevel: LogLevel;
  private static readonly emojis: Record<LogLevel, string> = {
    [LogLevel.debug]: "🐞",
    [LogLevel.info]: "ℹ️",
    [LogLevel.warn]: "⚠️",
    [LogLevel.error]: "❌",
  };

  public static initialize(env: Pick<Env.Private, "O_DOLOG_TIMEZONE" | "X_DOLOG_LOGGING">) {
    this.timeZone = env.O_DOLOG_TIMEZONE;
    this.globalLogLevel = env.X_DOLOG_LOGGING;
  }

  private readonly filename: string;
  private readonly lazy: boolean;

  public constructor(file: string, lazyArg?: "lazy") {
    this.lazy = lazyArg === "lazy";
    if (!this.lazy) {
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
    if (this.lazy) {
      this.requireInitialization();
    }
    if (this.shouldLog(level)) {
      const timestamp = Temporal.Now.plainDateTimeISO(Logger.timeZone).toString({ smallestUnit: "second" }).replace("T", " ");
      const prefix = `${timestamp} [${level.toUpperCase()}] ${Logger.emojis[level]} ${this.filename} |`;
      console[level].call(console, prefix, ...args);
    }
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
