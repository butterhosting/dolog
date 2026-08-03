import { mkdir } from "fs/promises";
import { dirname } from "path";
import { Sqlite } from "./drizzle/sqlite";
import { Env } from "./Env";
import { Logger } from "./Logger";
import { ServerRegistry } from "./ServerRegistry";

/**
 * Initialize the logger
 */
Logger.initialize(Env.initializePartiallyForLogger());

/**
 * Initialize the env configuration
 */
const env = Env.initialize();

/**
 * Create the main directories
 */
await mkdir(dirname(env.X_DOLOG_DATABASE), { recursive: true });

/**
 * Initialize the database
 */
const sqlite = await Sqlite.initialize(env);

/**
 * Bootstrap the registry
 */
const registry = await ServerRegistry.bootstrap(env, sqlite);

/**
 * Run all initializer functions in the order their services were registered.
 */
registry.initializeAll();
