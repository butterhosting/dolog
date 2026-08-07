import { Env } from "@/Env";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export type Sqlite = Awaited<ReturnType<typeof Sqlite.initialize>>;

export namespace Sqlite {
  export async function initialize(env: Env.Private) {
    const database = new Database(env.X_DOLOG_DATABASE, { create: true });
    const sqlite = drizzle(database, {
      casing: "snake_case",
      schema,
    });
    migrate(sqlite, {
      migrationsFolder: "src/drizzle/migrations",
    });
    sqlite.run("PRAGMA foreign_keys = ON");
    // Retention writes continuously while the api reads; in the default rollback journal those
    // block each other. WAL lets them run side by side, and `NORMAL` skips the per-commit fsync.
    // A crash can cost the last batch of log lines, which is OK.
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA synchronous = NORMAL");
    return Object.assign(sqlite, {
      close: () => database.close(),
    });
  }
}
