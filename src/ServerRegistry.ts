import { Class } from "@/types/Class";
import { Env } from "./Env";
import { LoggingMiddleware } from "./middleware/logging/LoggingMiddleware";
import { Middleware } from "./middleware/Middleware";
import { Server } from "./Server";
import { ContainerService } from "./services/ContainerService";
import { DockerFountain } from "./services/docker/DockerFountain";
import { DockerSocket } from "./services/docker/DockerSocket";
import { ThrottleService } from "./services/ThrottleService";
import { SocketService } from "./socket/SocketService";

export class ServerRegistry {
  public static async bootstrap(env: Env.Private): Promise<ServerRegistry> {
    return new ServerRegistry(env);
  }

  private readonly registry: Record<string, any> = {};

  private constructor(private readonly env: Env.Private) {
    // Docker
    const { dockerSocket } = this.register({ DockerSocket }, [env]);
    const { dockerFountain } = this.register({ DockerFountain }, [dockerSocket]);

    // Services
    const { socketService } = this.register({ SocketService }, []);
    const { throttleService } = this.register({ ThrottleService }, [env]);
    const { containerService } = this.register({ ContainerService }, [dockerFountain, throttleService]);

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
