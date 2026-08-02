import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const $container = sqliteTable("container", {
  id: integer().primaryKey(),
  dockerId: text().notNull().unique(),
  name: text().notNull(),
  groupName: text(),
  firstSeen: text().notNull(),
  lastSeen: text().notNull(),
});
