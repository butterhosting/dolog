import { Class } from "@/types/Class";
import { Sqlite } from "./drizzle/sqlite";
import { Initialize } from "./Initialize";
import { Env } from "./Env";
import { LoggingMiddleware } from "./middleware/logging/LoggingMiddleware";
import { Middleware } from "./middleware/Middleware";
import { LogRepository } from "./repositories/LogRepository";
import { Server } from "./Server";
import { AlertingService } from "./services/AlertingService";
import { ContainerService } from "./services/ContainerService";
import { LogService } from "./services/LogService";
import { RetentionService } from "./services/RetentionService";
import { DockerSocket } from "./services/streaming/DockerSocket";
import { Fountain } from "./services/streaming/Fountain";
import { ThrottleService } from "./services/streaming/ThrottleService";
import { SocketService } from "./socket/SocketService";

export class ServerRegistry {
  public static async bootstrap(env: Env.Private, sqlite: Sqlite): Promise<ServerRegistry> {
    return await new ServerRegistry(env, sqlite).initializeAll();
  }

  private readonly registry: Record<string, any> = {};

  private constructor(
    private readonly env: Env.Private,
    private readonly sqlite: Sqlite,
  ) {
    // Repositories
    const { logRepository } = this.register({ LogRepository }, [sqlite]);

    // Services
    const { dockerSocket } = this.register({ DockerSocket }, [env]);
    const { throttleService } = this.register({ ThrottleService }, [env]);
    const { fountain } = this.register({ Fountain }, [dockerSocket, throttleService]);
    this.register({ RetentionService }, [fountain, env, logRepository]);
    this.register({ AlertingService }, [fountain]);
    const { socketService } = this.register({ SocketService }, []);
    const { containerService } = this.register({ ContainerService }, [fountain, dockerSocket, logRepository, socketService]);
    const { logService } = this.register({ LogService }, [fountain, logRepository, socketService]);

    // Middleware
    const { loggingMiddleware } = this.register({ LoggingMiddleware }, []);
    const { middleware } = this.register({ Middleware }, [loggingMiddleware]);

    // Server
    this.register({ Server }, [env, containerService, logService, socketService, middleware]);
  }

  /**
   * Initializes all components in the dependency order they were registered above
   */
  private async initializeAll(): Promise<ServerRegistry> {
    for (const instance of Object.values(this.registry)) {
      await Initialize.runAll(instance);
    }
    return this;
  }

  public get(sqlite: "sqlite"): Sqlite;
  public get(env: "env"): Env.Private;
  public get<T>(klass: Class<T>): T;
  public get<T>(klass: "sqlite" | "env" | Class<T>): Sqlite | Env.Private | T {
    if (klass === "sqlite") {
      return this.sqlite;
    }
    if (klass === "env") {
      return this.env;
    }
    const result = this.registry[klass.name] as T;
    if (!result) {
      throw new Error(`No registration for ${klass.name}`);
    }
    return result;
  }

  private register<N extends string, C extends Class>(
    classRecord: Record<N, C>,
    parameters: ConstructorParameters<C>,
  ): Record<Uncapitalize<N>, InstanceType<C>> {
    const entry = Object.entries(classRecord).at(0)!;
    const name = entry[0] as N;
    const Klass = entry[1] as C;
    const instance: InstanceType<C> = new Klass(...parameters);
    this.registry[Klass.name] = instance;
    return {
      [`${name[0].toLowerCase()}${name.slice(1)}`]: instance,
    } as Record<Uncapitalize<N>, InstanceType<C>>;
  }
}
