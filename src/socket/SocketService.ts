import { Logger } from "@/Logger";
import { Temporal } from "@js-temporal/polyfill";
import { ServerMessage } from "./ServerMessage";
import { Socket } from "./Socket";

const HEARTBEAT_INTERVAL_MS = 1_000;

export class SocketService {
  private readonly log = new Logger(__filename);
  private readonly sockets: Socket[] = [];
  private heartbeat?: ReturnType<typeof setInterval>;

  public registerSocket = (socket: Socket) => {
    this.log.debug(`Socket connected: ${socket.data.clientId}`);
    this.sockets.push(socket);
  };

  public unregisterSocket = (socket: Socket) => {
    const index = this.sockets.findIndex((s) => s.data.clientId === socket.data.clientId);
    if (index >= 0) {
      this.log.debug(`Socket disconnected: ${socket.data.clientId}`);
      this.sockets.splice(index, 1);
    }
  };

  /**
   * Pushes a heartbeat to every connected client, once per second.
   */
  public startHeartbeat = () => {
    this.heartbeat ??= setInterval(() => {
      this.broadcast({
        type: ServerMessage.Type.heartbeat,
        timestamp: Temporal.Now.instant().toString(),
      });
    }, HEARTBEAT_INTERVAL_MS);
  };

  public broadcast = (message: ServerMessage) => {
    const payload = JSON.stringify(message);
    this.sockets.forEach((socket) => socket.send(payload));
  };
}
