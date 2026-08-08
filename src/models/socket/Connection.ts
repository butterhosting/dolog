import { Socket } from "./Socket";

export type Connection = {
  socket: Socket;
  /**
   * When anything last arrived from this peer -- a pong, or a message it sent of its own accord.
   *
   * Silence is the only way a dead connection announces itself: writing to one succeeds, because a
   * send means "queued in the kernel", not "delivered", and a peer whose network vanished sends no
   * close of any kind.
   */
  lastHeardAt: number;
  watchedContainerId: string | null;
  /** The live half of an active filter, compiled once when it was declared. */
  matches: ((line: string) => boolean) | null;
};
