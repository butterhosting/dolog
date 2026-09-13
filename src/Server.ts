import { Env } from "@/Env";
import { Initialize } from "@/Initialize";
import { ServerError } from "@/errors/ServerError";
import index from "@/website/index.html";
import { Temporal } from "@js-temporal/polyfill";
import { ErrorLike } from "bun";
import { randomUUID } from "crypto";
import { Yexception } from "yexception";
import { Logger } from "./Logger";
import { Middleware } from "./middleware/Middleware";
import { Svc } from "./models/Svc";
import { Socket } from "./models/socket/Socket";
import { HostService } from "./services/HostService";
import { LogService } from "./services/LogService";
import { SocketService } from "./services/SocketService";
import { SvcService } from "./services/SvcService";

export class Server {
  private readonly log = new Logger(__filename);

  public constructor(
    private readonly env: Env.Private,
    private readonly svcService: SvcService,
    private readonly logService: LogService,
    private readonly hostService: HostService,
    private readonly socketService: SocketService,
    private readonly middleware: Middleware,
  ) {}

  @Initialize
  public listen() {
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
          // both of these used to answer 200 with an error body, which reads as success to any caller
          // that checks the status before the payload
          return Response.json(ServerError.socket_upgrade_failed().problemDetails(), { status: 426 });
        }
        return Response.json(ServerError.route_not_found().problemDetails(), { status: 404 });
      }),
      websocket: {
        message: (socket, message) => {
          this.socketService.receive(socket, `${message}`);
        },
        open: (socket) => {
          this.socketService.registerSocket(socket);
        },
        pong: (socket) => {
          this.socketService.recordAliveness(socket);
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
         * Host
         */
        "/internal-api/host": {
          GET: this.handleRoute(async () => Response.json(await this.hostService.get())),
        },

        /**
         * Services
         */
        "/internal-api/svcs": {
          GET: this.handleRoute(async () => {
            const overview: Svc[] = await this.svcService.list();
            return Response.json(overview);
          }),
        },

        /**
         * Logs
         */
        "/internal-api/svcs/:id/logs": {
          GET: this.handleRoute(async ({ params, url }) => {
            const query = Object.fromEntries(new URL(url).searchParams);
            return Response.json(await this.logService.list(Svc.decodeId(params.id), query));
          }),
        },
        // a position, not a page: the caller usually holds the line already and only has to scroll
        "/internal-api/svcs/:id/logs/find": {
          GET: this.handleRoute(async ({ params, url }) => {
            const query = Object.fromEntries(new URL(url).searchParams);
            return Response.json(await this.logService.find(Svc.decodeId(params.id), query));
          }),
        },
      },

      /**
       * Error handling
       */
      error: (e) => this.handleError(e),
    });

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
