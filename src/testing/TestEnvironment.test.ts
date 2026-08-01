import { DockerSocket } from "@/services/docker/DockerSocket";
import { Env } from "@/Env";
import { Logger } from "@/Logger";
import { LogLevel } from "@/models/LogLevel";
import { OmitBetter } from "@/types/OmitBetter";
import { jest, mock, Mock } from "bun:test";
import { join } from "path";

export namespace TestEnvironment {
  type Mocked<T> = {
    [K in keyof T]: T[K] extends (...args: any[]) => any ? Mock<T[K]> : never;
  } & {
    cast: () => T;
  };

  export interface Context {
    env: Env.Private;
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
    });
    const patchEnvironmentVariables = (environment: Record<string, string>) => {
      Object.assign(Bun.env, environment);
    };

    // Initialize the logger
    Logger.initialize(env);

    // Mock registration
    function registerMockObject<T>(mockObject: OmitBetter<Mocked<T>, "cast">): Mocked<T> {
      const extra = { cast: () => mockObject as T } as Pick<Mocked<T>, "cast">;
      Object.assign(mockObject, extra);
      return mockObject as Mocked<T>;
    }

    // Dependencies
    const dockerSocketMock = registerMockObject<DockerSocket>({
      listRunningContainers: mock(),
      hasTty: mock(),
      streamLifecycle: mock(),
      streamLogs: mock(),
    });

    return {
      env,
      patchEnvironmentVariables,
      dockerSocketMock,
    };
  }
}
