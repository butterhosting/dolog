import { mkdir } from "fs/promises";
import { Env } from "./Env";
import { Logger } from "./Logger";
import { Server } from "./Server";
import { ServerRegistry } from "./ServerRegistry";
import { RetentionService } from "./services/RetentionService";

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
await mkdir(env.X_DOLOG_ROOT, { recursive: true });

/**
 * Bootstrap the registry
 */
const registry = await ServerRegistry.bootstrap(env);

/**
 * Initialize the application
 */
registry.get(RetentionService).initialize();
registry.get(Server).listen();
