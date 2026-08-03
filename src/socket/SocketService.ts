import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ClientMessage } from "./ClientMessage";
import { ServerMessage } from "./ServerMessage";
import { Socket } from "./Socket";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";

/** Everything we track about one connected browser, so that forgetting it is a single delete. */
type Connection = {
  socket: Socket;
  /**
   * Which container this browser is looking at. Log events go only to the sockets that asked for
   * them: one sitting on the overview should not pay for the traffic of every container on the host.
   */
  watchedContainer: string | null;
  /** Pings sent since we last heard anything back. */
  unanswered: number;
};

export class SocketService {
  private readonly log = new Logger(__filename);
  private readonly connections = new Map<string, Connection>();

  public registerSocket = (socket: Socket) => {
    this.log.debug(`Socket connected: ${socket.data.clientId}`);
    this.connections.set(socket.data.clientId, { socket, watchedContainer: null, unanswered: 0 });
  };

  public unregisterSocket = (socket: Socket) => {
    if (this.connections.delete(socket.data.clientId)) {
      this.log.debug(`Socket disconnected: ${socket.data.clientId}`);
    }
  };

  /**
   * A plain method rather than a field, so the mark lands on the prototype where {@link Initialize}
   * looks for it.
   */
  @Initialize
  public keepConnectionsAlive() {
    const KEEPALIVE_INTERVAL_MS = 25 * 1_000;
    const MISSED_PINGS_BEFORE_DROP = 2;

    setInterval(() => {
      this.connections.forEach((connection, clientId) => {
        if (connection.unanswered >= MISSED_PINGS_BEFORE_DROP) {
          this.log.debug(`Socket ${clientId} stopped answering, closing it`);
          connection.socket.close();
          return;
        }
        connection.unanswered += 1;
        connection.socket.ping();
      });
    }, KEEPALIVE_INTERVAL_MS);
  }

  public hasConnections = (): boolean => {
    return this.connections.size > 0;
  };

  public heard = (socket: Socket) => {
    const connection = this.connections.get(socket.data.clientId);
    if (connection) {
      connection.unanswered = 0;
    }
  };

  public receive = (socket: Socket, raw: string) => {
    const connection = this.connections.get(socket.data.clientId);
    if (!connection) {
      return;
    }
    connection.unanswered = 0;
    try {
      const message = ClientMessage.parse(JSON.parse(raw));
      switch (message.type) {
        case ClientMessage.Type.watch:
          connection.watchedContainer = message.containerId;
      }
    } catch (error) {
      this.log.warn(`Ignoring unreadable message from ${socket.data.clientId}`, error);
    }
  };

  public broadcastLog = (event: ContainerEvent) => {
    const watchers = [...this.connections.values()].filter((connection) => connection.watchedContainer === event.container.id);
    if (watchers.length > 0) {
      const message: ServerMessage = {
        type: ServerMessage.Type.log,
        event,
      };
      watchers.forEach((connection) => {
        connection.socket.send(JSON.stringify(message));
      });
    }
  };

  public broadcastContainers = (containers: ContainerRM[]) => {
    const message: ServerMessage = {
      type: ServerMessage.Type.containers,
      containers,
    };
    this.connections.forEach(({ socket }) => socket.send(JSON.stringify(message)));
  };
}
