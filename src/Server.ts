import { Env } from "@/Env";
import { ServerError } from "@/errors/ServerError";
import index from "@/website/index.html";
import { Temporal } from "@js-temporal/polyfill";
import { ErrorLike } from "bun";
import { randomUUID } from "crypto";
import { firstValueFrom } from "rxjs";
import { Yexception } from "yexception";
import { Logger } from "./Logger";
import { Middleware } from "./middleware/Middleware";
import { Throughput } from "./models/Throughput";
import { LogService } from "./services/LogService";
import { Socket } from "./socket/Socket";
import { SocketService } from "./socket/SocketService";

export class Server {
  private readonly log = new Logger(__filename);

  public constructor(
    private readonly env: Env.Private,
    private readonly logService: LogService,
    private readonly socketService: SocketService,
    private readonly middleware: Middleware,
  ) {}

  public initialize() {
    const server: Bun.Server<Socket.Context> = Bun.serve({
      development: this.env.O_DOLOG_STAGE === "dev",
      /**
       * Websockets
       */
      fetch: this.handleFetch(async (request, server) => {
        const { pathname } = new URL(request.url);
        if (pathname === "/socket") {
          const context: Socket.Context = {
            clientId: `${randomUUID()}`,
          };
          if (server.upgrade(request, { data: context })) {
            return new Response(null, { status: 200 });
          }
          return Response.json(ServerError.socket_upgrade_failed().problemDetails());
        }
        return Response.json(ServerError.route_not_found().problemDetails());
      }),
      websocket: {
        message: () => {
          // Ignore any incoming client messages
        },
        open: (socket) => {
          this.socketService.registerSocket(socket);
        },
        close: (socket) => {
          this.socketService.unregisterSocket(socket);
        },
      },
      routes: {
        /**
         * HTML/API fallbacks
         *
         * Unfortunately, no middleware on the HTMLBundle right now; see
         * https://github.com/oven-sh/bun/issues/17595#issuecomment-2965865078
         *
         * (the suggested "secret asset path" breaks my websocket, unfortunately)
         */
        "/*": index,
        "/internal-api/*": this.handleRoute(() => {
          return Response.json(ServerError.route_not_found().problemDetails(), { status: 404 });
        }),

        /**
         * Health (used as the container healthcheck)
         */
        "/health": {
          GET: this.handleRoute(() => {
            return Response.json({ status: "ok" });
          }),
        },

        /**
         * Env
         */
        "/internal-api/env": {
          GET: this.handleRoute(() => {
            const response = Object.entries(this.env)
              .filter(([key]) => key.startsWith("O_DOLOG_" satisfies Env.PublicPrefix))
              .map(([key, value]) => ({ [key]: value }))
              .reduce((kv1, kv2) => Object.assign({}, kv1, kv2), {});
            return Response.json(response as Env.Public);
          }),
        },

        /**
         * Containers
         */
        "/internal-api/containers/throughput": {
          GET: this.handleRoute(async () => {
            // the throughput stream replays its latest reading, so this resolves immediately
            const throughput: Throughput[] = await firstValueFrom(this.logService.streamThroughputs());
            return Response.json(throughput);
          }),
        },
      },

      /**
       * Error handling
       */
      error: (e) => this.handleError(e),
    });

    /**
     * Start pushing a heartbeat to every connected client
     */
    this.socketService.startHeartbeat();

    // ordinary log, so this is always printed (independent of log level)
    console.log(
      [
        "",
        `  🚀 \x1b[1mDolog started on ${Temporal.Now.plainDateTimeISO(this.env.O_DOLOG_TIMEZONE)
          .toString({ smallestUnit: "second" })
          .replace("T", " ")} (${this.env.O_DOLOG_TIMEZONE})\x1b[0m`,
        "",
        `  \x1b[1mServer\x1b[0m    ${server.url}`,
        "",
        `  \x1b[1mStage\x1b[0m     ${this.env.O_DOLOG_STAGE}`,
        `  \x1b[1mCommit\x1b[0m    ${this.env.O_DOLOG_COMMIT}`,
        `  \x1b[1mVersion\x1b[0m   ${this.env.O_DOLOG_VERSION}`,
        "",
        `  \x1b[1mLogging\x1b[0m   ${this.env.X_DOLOG_LOGGING}`,
        `  \x1b[1mTimezone\x1b[0m  ${this.env.O_DOLOG_TIMEZONE}`,
        `  \x1b[1mSocket\x1b[0m    ${this.env.X_DOLOG_DOCKER_SOCKET}`,
        `  \x1b[1mThrottle\x1b[0m  ${this.env.X_DOLOG_THROTTLE_LOGS_PER_SECOND} logs/second/container`,
        "",
      ].join("\n"),
    );
  }

  private handleFetch<C>(
    fn: (request: Request, server: Bun.Server<C>) => Response | Promise<Response>,
  ): (request: Request, server: Bun.Server<C>) => Promise<Response> {
    return (request, server) =>
      this.middleware.handle(request, async () => {
        return await fn(request, server);
      });
  }

  private handleRoute<T extends string>(
    fn: (req: Bun.BunRequest<T>) => Response | Promise<Response>,
  ): (req: Bun.BunRequest<T>) => Promise<Response> {
    return (request) =>
      this.middleware.handle(request, async () => {
        return await fn(request);
      });
  }

  private async handleError(e: ErrorLike): Promise<Response> {
    if (Yexception.isInstance(e)) {
      return Response.json(e.problemDetails(), { status: 400 });
    }
    this.log.error("An unknown error occurred", e);
    return Response.json(ServerError.unknown().problemDetails(), { status: 500 });
  }
}
