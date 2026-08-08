import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { LineMatch } from "@/helpers/LineMatch";
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
    this.connections.set(socket.data.clientId, { socket, watchedContainerId: null, matches: null, lastHeardAt: Date.now() });
  };

  public unregisterSocket = (socket: Socket) => {
    if (this.connections.delete(socket.data.clientId)) {
      this.log.debug(`Socket disconnected: ${socket.data.clientId}`);
    }
  };

  /**
   * Browsers answer a ping in their network stack, with no help from the page, so this needs nothing
   * on the client side. It is the only way to notice a peer that has quietly gone: see {@link
   * Connection.lastHeardAt}.
   */
  @Initialize
  public keepConnectionsAlive() {
    const KEEPALIVE_INTERVAL = Temporal.Duration.from({ seconds: 25 });
    // one interval of silence could be a hiccup; two says the peer is not coming back
    const SILENCE_BEFORE_DROP = Temporal.Duration.from({ seconds: 50 });

    setInterval(() => {
      this.connections.forEach((connection, clientId) => {
        const silentFor = Date.now() - connection.lastHeardAt;
        if (silentFor > SILENCE_BEFORE_DROP.total("milliseconds")) {
          this.log.debug(`Socket ${clientId} went quiet ${Math.round(silentFor / 1000)}s ago, closing it`);
          connection.socket.close();
          return;
        }
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
      connection.lastHeardAt = Date.now();
    }
  };

  public receive = (socket: Socket, raw: string) => {
    const connection = this.connections.get(socket.data.clientId);
    if (!connection) {
      return;
    }
    // a message is as good a sign of life as a pong, so it counts the same and is recorded the same way
    this.heard(socket);
    try {
      const message = ClientMessage.parse(JSON.parse(raw));
      switch (message.type) {
        case ClientMessage.Type.declare_stream_interest:
          connection.watchedContainerId = message.containerId;
          /**
           * Compiled once, here, rather than per arriving line -- and a pattern that will not
           * compile is refused at the moment it is declared instead of throwing forever afterwards.
           */
          connection.matches = message.matcher
            ? LineMatch.predicate(message.matcher.pattern, message.matcher.variant)
            : null;
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
    const serialized = JSON.stringify(message);
    [...this.connections.values()]
      .filter((connection) => connection.watchedContainerId === event.container.id)
      // a filtered view is the whole view, so a line it excludes must not arrive down the live feed
      .filter((connection) => !connection.matches || (event.type === ContainerEvent.Type.log && connection.matches(event.line)))
      .forEach((connection) => {
        connection.socket.send(serialized);
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
