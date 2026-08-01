import { ServerWebSocket } from "bun";

export type Socket = ServerWebSocket<Socket.Context>;

export namespace Socket {
  export type Context = {
    clientId: string;
  };
}
