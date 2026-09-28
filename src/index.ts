import { mkdir, stat } from "fs/promises";
import { dirname } from "path";
import { Sqlite } from "./drizzle/sqlite";
import { Env } from "./Env";
import { DockerError } from "./errors/DockerError";
import { Logger } from "./Logger";
import { Server } from "./Server";
import { ServerRegistry } from "./ServerRegistry";
import { DockerSocket } from "./services/streaming/DockerSocket";

Logger.initialize(Env.initialize.partiallyForLogger());
const env = Env.initialize();

if (!env.INTERACTIVE_DEMO) {
  const isSocketAvailable = await stat(DockerSocket.PATH).then(
    (s) => s.isSocket(),
    () => false,
  );
  if (!isSocketAvailable) {
    throw DockerError.socket_unreachable({ socket: DockerSocket.PATH });
  }
}

if (!env.INTERACTIVE_DEMO) {
  await mkdir(dirname(env.DOLOG_DATABASE), { recursive: true });
}
const sqlite = await Sqlite.initialize(env);

const registry = await ServerRegistry.bootstrap(env, sqlite);

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    await registry.get(Server).stop();
    sqlite.close();
    process.exit(0);
  });
}
