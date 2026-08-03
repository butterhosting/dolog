import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { $container } from "./$container";

/**
 * `id` is a uuidv7, minted where the event is created rather than where it is stored -- so a line
 * still on its way to disk can already be named, which is what lets a browser ask for whatever came
 * before the line at the top of its screen.
 *
 * Being time-ordered, it sorts the way a rowid would: "delete the oldest" stays a walk along the
 * key, and no separate index on `timestamp` is needed.
 */
export const $containerEvent = sqliteTable(
  "container_event",
  {
    /** A uuidv7 in its raw sixteen bytes; {@link Uuid} converts at the edges, it stays bytes in between. */
    id: blob({ mode: "buffer" }).primaryKey(),
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
