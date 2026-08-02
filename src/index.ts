import { mkdir } from "fs/promises";
import { ContainerEventPrinter } from "./ContainerEventPrinter";
import { Env } from "./Env";
import { Logger } from "./Logger";
import { Server } from "./Server";
import { ServerRegistry } from "./ServerRegistry";
import { ContainerService } from "./services/ContainerService";

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
 * Turn on the fountain. The only observer for now prints to stdout; retention, alerting and the
 * frontend websocket will all attach to this same stream.
 */
const log = new Logger(__filename);
registry
  .get(ContainerService)
  .activateFountain()
  .subscribe({
    next: (event) => console.log(ContainerEventPrinter.format(event)),
    error: (error) => log.error("The container event stream died", error),
  });

/**
 * Initialize the application
 */
registry.get(Server).listen();
