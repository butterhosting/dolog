import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import { Connection } from "@/models/socket/Connection";
import { Temporal } from "@js-temporal/polyfill";
import { ClientMessage } from "../models/socket/ClientMessage";
import { ServerMessage } from "../models/socket/ServerMessage";
import { Socket } from "../models/socket/Socket";

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

  @Initialize
  public keepConnectionsAlive() {
    const KEEPALIVE_INTERVAL = Temporal.Duration.from({ seconds: 25 });
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
    }, KEEPALIVE_INTERVAL.total("milliseconds"));
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

  public broadcastEventStream = (event: ContainerEvent) => {
    const message: ServerMessage = {
      type: ServerMessage.Type.log,
      event,
    };
    [...this.connections.values()]
      .filter((connection) => connection.watchedContainer === event.container.id)
      .forEach((connection) => {
        connection.socket.send(JSON.stringify(message));
      });
  };

  public broadcastContainers = (containers: ContainerRM[]) => {
    const message: ServerMessage = {
      type: ServerMessage.Type.containers,
      containers,
    };
    this.connections.forEach(({ socket }) => socket.send(JSON.stringify(message)));
  };
}
