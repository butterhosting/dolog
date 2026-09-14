import { DockerSocket } from "@/services/streaming/DockerSocket";
import { Sqlite } from "@/drizzle/sqlite";
import { Env } from "@/Env";
import { Initialize } from "@/Initialize";
import { EventRepository } from "@/repositories/EventRepository";
import { Logger } from "@/Logger";
import { LogLevel } from "@/models/internal/LogLevel";
import { OmitBetter } from "@/types/OmitBetter";
import { jest, mock, Mock } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { Subject } from "rxjs";
import { dirname, join } from "path";

export namespace TestEnvironment {
  type Mocked<T> = {
    [K in keyof T]: T[K] extends (...args: any[]) => any ? Mock<T[K]> : never;
  } & {
    cast: () => T;
  };

  export interface Context {
    env: Env.Private;
    sqlite: Sqlite;
    eventRepository: EventRepository;
    flushTrigger: Subject<void>;
    patchEnvironmentVariables(environment: Record<string, string>): void;
    dockerSocketMock: Mocked<DockerSocket>;
  }

  const cleanupTasks: Array<() => unknown | Promise<unknown>> = [];
  const originalEnv = { ...Bun.env };

  export async function initialize(): Promise<Context> {
    // Cleanup between unit tests
    mock.restore();
    jest.clearAllMocks();
    jest.restoreAllMocks();
    Object.assign(Bun.env, originalEnv);
    while (cleanupTasks.length > 0) {
      const task = cleanupTasks.pop()!; // in reverse order = important!
      await task();
    }

    // Ensure we're running from the project root
    const cwd = await (async function ensureValidCwd(): Promise<string> {
      const cwd = process.cwd();
      const packageJsonPath = join(cwd, "package.json");
      const packageJsonFile = Bun.file(packageJsonPath);
      if (!(await packageJsonFile.exists())) {
        throw new Error(`Invalid working directory, package.json not found: ${packageJsonPath}`);
      }
      const { name } = await packageJsonFile.json();
      if (name !== "dolog") {
        throw new Error(`Invalid working directory, invalid project name in package.json: ${name}`);
      }
      return cwd;
    })();

    // Setup env
    // We'd have to make this root unique (with a random part) to support parallel unit tests,
    // but Bun is so fast it's not needed
    const unitTestRoot = join(cwd, "opt", "unit-test");
    const env = Env.initialize("UTC", {
      O_DOLOG_STAGE: "dev",
      O_DOLOG_TIMEZONE: "UTC",
      X_DOLOG_ROOT: join(unitTestRoot, "dolog"),
      X_DOLOG_LOGGING: LogLevel.warn,
      X_DOLOG_DOCKER_SOCKET: "/var/run/docker.sock",
      X_DOLOG_THROTTLE_LOGS_PER_SECOND: "5",
      X_DOLOG_RETENTION_TIME_WINDOW: "30d",
      X_DOLOG_RETENTION_MAX_LINES: "100000",
    });
    const patchEnvironmentVariables = (environment: Record<string, string>) => {
      Object.assign(Bun.env, environment);
    };

    // Initialize the logger
    Logger.initialize(env);

    // Setup filesystem
    await mkdir(dirname(env.X_DOLOG_DATABASE), { recursive: true });
    // WAL keeps two sidecar files; leaving them behind would pair a stale journal with a fresh database
    await Promise.all(
      [`${env.X_DOLOG_DATABASE}`, `${env.X_DOLOG_DATABASE}-wal`, `${env.X_DOLOG_DATABASE}-shm`].map((file) => rm(file, { force: true })),
    );

    // Setup SQLite
    const sqlite = await Sqlite.initialize(env);
    cleanupTasks.push(() => sqlite.close());

    // Mock registration
    function registerMockObject<T>(mockObject: OmitBetter<Mocked<T>, "cast">): Mocked<T> {
      const extra = { cast: () => mockObject as T } as Pick<Mocked<T>, "cast">;
      Object.assign(mockObject, extra);
      return mockObject as Mocked<T>;
    }

    // Dependencies
    const dockerSocketMock = registerMockObject<DockerSocket>({
      listRunningContainers: mock(),
      inspectHost: mock(),
      streamLifecycles: mock(),
      streamLogLines: mock(),
      streamStats: mock(),
    });

    /** Stands in for the clock the repository would otherwise flush on, so tests decide when. */
    const flushTrigger = new Subject<void>();
    const eventRepository = new EventRepository(sqlite, flushTrigger);
    await Initialize.runAll(eventRepository);

    return {
      env,
      sqlite,
      eventRepository,
      flushTrigger,
      patchEnvironmentVariables,
      dockerSocketMock,
    };
  }
}
