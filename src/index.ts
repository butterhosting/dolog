import { mkdir, stat } from "fs/promises";
import { dirname } from "path";
import { Sqlite } from "./drizzle/sqlite";
import { Env } from "./Env";
import { DockerError } from "./errors/DockerError";
import { Logger } from "./Logger";
import { ServerRegistry } from "./ServerRegistry";
import { DockerSocket } from "./services/streaming/DockerSocket";

Logger.initialize(Env.initialize.partiallyForLogger());
const env = Env.initialize();

if (!env.DOLOG_DEMO) {
  const isSocketAvailable = await stat(DockerSocket.PATH).then(
    (s) => s.isSocket(),
    () => false,
  );
  if (!isSocketAvailable) {
    throw DockerError.socket_unreachable({ socket: DockerSocket.PATH });
  }
}

if (!env.DOLOG_DEMO) {
  await mkdir(dirname(env.DOLOG_DATABASE), { recursive: true });
}
const sqlite = await Sqlite.initialize(env);

await ServerRegistry.bootstrap(env, sqlite);
