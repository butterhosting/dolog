import { $containerEvent } from "@/drizzle/schema";
import { Sqlite } from "@/drizzle/sqlite";
import { Env } from "@/Env";
import { ServerError } from "@/errors/ServerError";
import { Logger } from "@/Logger";

export class RestrictedService {
  private readonly log = new Logger(__filename);

  public constructor(
    private readonly env: Env.Private,
    private readonly sqlite: Sqlite,
  ) {}

  /**
   * Forgets every event, so a test run starts from a log that begins now. The containers stay: the
   * stream holds on to the ones that are running, and would be writing against rows that are gone
   */
  public async purge(): Promise<void> {
    if (this.env.DOLOG_STAGE === "prod") {
      throw ServerError.route_not_found();
    }

    this.sqlite.delete($containerEvent).run();
    this.log.info("Purged all events");
  }
}
