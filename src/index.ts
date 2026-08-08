import { mkdir } from "fs/promises";
import { dirname } from "path";
import { Sqlite } from "./drizzle/sqlite";
import { Env } from "./Env";
import { Logger } from "./Logger";
import { ServerRegistry } from "./ServerRegistry";

Logger.initialize(Env.initializePartiallyForLogger());
const env = Env.initialize();

await mkdir(dirname(env.X_DOLOG_DATABASE), { recursive: true });
const sqlite = await Sqlite.initialize(env);

await ServerRegistry.bootstrap(env, sqlite);
