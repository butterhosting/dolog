import { mkdir, stat } from "fs/promises";
import { dirname } from "path";
import { Sqlite } from "./drizzle/sqlite";
import { Env } from "./Env";
import { DockerError } from "./errors/DockerError";
import { Logger } from "./Logger";
import { ServerRegistry } from "./ServerRegistry";

Logger.initialize(Env.initialize.partiallyForLogger());
const env = Env.initialize();

if (!env.DOLOG_DEMO) {
  const isSocketAvailable = await stat(env.DOLOG_DOCKER_SOCKET).then(
    (s) => s.isSocket(),
    () => false,
  );
  if (!isSocketAvailable) {
    throw DockerError.socket_unreachable({ socket: env.DOLOG_DOCKER_SOCKET });
  }
}

await mkdir(dirname(env.DOLOG_DATABASE), { recursive: true });
const sqlite = await Sqlite.initialize(env);

await ServerRegistry.bootstrap(env, sqlite);
