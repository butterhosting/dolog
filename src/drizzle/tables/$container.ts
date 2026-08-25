import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const $container = sqliteTable("container", {
  id: integer().primaryKey(),
  did: text().notNull(), // "Docker ID"
  dname: text().notNull(), // "Docker name"
  dgroup: text(), // "Docker group"
  online: integer({ mode: "boolean" }).notNull(),
});
