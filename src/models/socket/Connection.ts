import { Socket } from "./Socket";

export type Connection = {
  socket: Socket;
  watchedContainer: string | null;
  unanswered: number;
};
