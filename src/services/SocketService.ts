import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerRM } from "@/models/ContainerRM";
import { LogPattern } from "@/models/LogPattern";
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
    this.connections.set(socket.data.clientId, {
      socket,
      watchedContainerId: null,
      logPredicate: null,
      lastHeardBack: Temporal.Now.instant(),
    });
  };

  public unregisterSocket = (socket: Socket) => {
    if (this.connections.delete(socket.data.clientId)) {
      this.log.debug(`Socket disconnected: ${socket.data.clientId}`);
    }
  };

  @Initialize
  public keepConnectionsAlive() {
    const KEEPALIVE_INTERVAL = Temporal.Duration.from({ seconds: 25 });
    const SILENCE_BEFORE_DROP = Temporal.Duration.from({ seconds: 50 });

    setInterval(() => {
      this.connections.forEach((connection, clientId) => {
        const silentFor = Temporal.Now.instant().since(connection.lastHeardBack);
        if (Temporal.Duration.compare(silentFor, SILENCE_BEFORE_DROP) > 0) {
          this.log.debug(`Socket ${clientId} went quiet ${silentFor.total("seconds")}s ago, closing it`);
          connection.socket.close();
          return;
        }
        connection.socket.ping();
      });
    }, KEEPALIVE_INTERVAL.total("milliseconds"));
  }

  public broadcastEventStream = (data: ContainerEvent) => {
    const message: ServerMessage = {
      type: ServerMessage.Type.log,
      data,
    };
    [...this.connections.values()]
      .filter((connection) => connection.watchedContainerId === data.container.id)
      .filter((connection) => !connection.logPredicate || (data.type === ContainerEvent.Type.log && connection.logPredicate(data.line)))
      .forEach((connection) => connection.socket.send(JSON.stringify(message)));
  };

  public broadcastContainers = (containers: ContainerRM[]) => {
    const message: ServerMessage = {
      type: ServerMessage.Type.containers,
      containers,
    };
    this.connections.forEach(({ socket }) => socket.send(JSON.stringify(message)));
  };

  public receive = (socket: Socket, raw: string) => {
    const connection = this.connections.get(socket.data.clientId);
    if (!connection) {
      return;
    }
    this.recordAliveness(socket);
    try {
      const message = ClientMessage.parse(JSON.parse(raw));
      switch (message.type) {
        case ClientMessage.Type.declare_stream_interest:
          connection.watchedContainerId = message.containerId;
          connection.logPredicate = message.logPattern ? LogPattern.predicate(message.logPattern) : null;
      }
    } catch (error) {
      this.log.warn(`Ignoring unreadable message from ${socket.data.clientId}`, error);
    }
  };

  public hasConnections = (): boolean => {
    return this.connections.size > 0;
  };

  public recordAliveness = (socket: Socket) => {
    const connection = this.connections.get(socket.data.clientId);
    if (connection) {
      connection.lastHeardBack = Temporal.Now.instant();
    }
  };
}
