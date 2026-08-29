import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Connection } from "@/models/socket/Connection";
import { Svc } from "@/models/Svc";
import { PredicateFactory } from "@/repositories/PredicateFactory";
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
      lastHeardBack: Temporal.Now.instant(),
      filterDropThrottleEvents: false,
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
      this.log.debug(`Socket connection count: ${this.connections.size}`);
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

  public broadcastEventStream = (event: ContainerEvent) => {
    const message: ServerMessage = {
      type: ServerMessage.Type.event,
      data: event,
    };
    [...this.connections.values()]
      .filter((connection) => connection.watchedSvcId && Svc.matches(connection.watchedSvcId, event.container))
      .filter((connection): boolean => {
        switch (event.type) {
          case ContainerEvent.Type.start:
          case ContainerEvent.Type.stop:
          case ContainerEvent.Type.log_throttle:
            return true;
          case ContainerEvent.Type.log:
            return !connection.filterPredicate || connection.filterPredicate(event);
        }
      })
      .forEach((connection) => connection.socket.send(JSON.stringify(message)));
  };

  public broadcastSvcs = (svcs: Svc[]) => {
    const message: ServerMessage = {
      type: ServerMessage.Type.svcs,
      svcs,
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
        case ClientMessage.Type.declare_stream_interest: {
          connection.watchedSvcId = message.svcId ? Svc.decodeId(message.svcId) : undefined;
          connection.filterPredicate = PredicateFactory.forFilter("full_object_test", message.filter ?? {});
          break;
        }
        default: {
          message.type satisfies never;
        }
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
