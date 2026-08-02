import { mkdir } from "fs/promises";
import { dirname } from "path";
import { Sqlite } from "./drizzle/sqlite";
import { Env } from "./Env";
import { Logger } from "./Logger";
import { Server } from "./Server";
import { ServerRegistry } from "./ServerRegistry";
import { RetentionService } from "./services/RetentionService";
import { ContainerService } from "./services/ContainerService";
import { LogService } from "./services/LogService";
import { ContainerEventRepository } from "./repositories/ContainerEventRepository";

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
 * Initialize the application
 */
registry.get(RetentionService).initialize();
registry.get(ContainerService).initialize();
registry.get(LogService).initialize();
registry.get(ContainerEventRepository).initialize();
registry.get(Server).initialize();
