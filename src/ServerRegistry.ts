import { Class } from "@/types/Class";
import { Env } from "./Env";
import { LoggingMiddleware } from "./middleware/logging/LoggingMiddleware";
import { Middleware } from "./middleware/Middleware";
import { Server } from "./Server";
import { ContainerService } from "./services/ContainerService";
import { Fountain } from "./services/streaming/Fountain";
import { DockerSocket } from "./services/streaming/DockerSocket";
import { ThrottleService } from "./services/streaming/ThrottleService";
import { SocketService } from "./socket/SocketService";

export class ServerRegistry {
  public static async bootstrap(env: Env.Private): Promise<ServerRegistry> {
    return new ServerRegistry(env);
  }

  private readonly registry: Record<string, any> = {};

  private constructor(private readonly env: Env.Private) {
    // Services
    const { dockerSocket } = this.register({ DockerSocket }, [env]);
    const { throttleService } = this.register({ ThrottleService }, [env]);
    const { fountain } = this.register({ Fountain }, [dockerSocket, throttleService]);
    const { containerService } = this.register({ ContainerService }, [fountain]);
    const { socketService } = this.register({ SocketService }, []);

    // Middleware
    const { loggingMiddleware } = this.register({ LoggingMiddleware }, []);
    const { middleware } = this.register({ Middleware }, [loggingMiddleware]);

    // Server
    this.register({ Server }, [env, containerService, socketService, middleware]);
  }

  public get(env: "env"): Env.Private;
  public get<T>(klass: Class<T>): T;
  public get<T>(klass: "env" | Class<T>): Env.Private | T {
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
