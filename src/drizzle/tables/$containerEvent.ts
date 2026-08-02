import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { $container } from "./$container";

export const $containerEvent = sqliteTable(
  "container_event",
  {
    id: integer().primaryKey(),
    container: integer()
      .notNull()
      .references(() => $container.id, { onDelete: "cascade" }),
    timestamp: text().notNull(),
    type: text().notNull(),
    streamVariant: text(),
    line: text(),
    foldCount: integer(),
  },
  (table) => [index("container_event_container_idx").on(table.container, table.id)],
);
