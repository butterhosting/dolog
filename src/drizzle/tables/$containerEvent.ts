import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const $containerEvent = sqliteTable("container_event", {
  // UUIDv7 as its raw 16 bytes to save some space
  id: blob({ mode: "buffer" }).primaryKey(),
  containerId: integer().notNull(),
  timestamp: text().notNull(),
  type: text().notNull(),
  streamVariant: text(),
  line: text(),
  foldCount: integer(),
});
