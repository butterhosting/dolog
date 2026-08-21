import { blob, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const $containerEvent = sqliteTable("container_event", {
  id: blob({ mode: "buffer" }).primaryKey(), // UUIDv7 as its raw 16 bytes to save some space
  containerId: integer().notNull(),
  timestamp: text().notNull(),
  type: text().notNull(),
  streamVariant: text(),
  line: text(),
  dropCount: integer(),
});
