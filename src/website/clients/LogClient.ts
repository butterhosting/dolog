import { LogService } from "@/services/LogService";
import { Yesttp } from "yesttp";

/**
 * Typed on the *input* side of the service's schemas, because that is what a client deals in: a
 * query string carries strings, and the parsing into instants and anchors happens on arrival.
 */
export class LogClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async find(containerId: string, options: LogService.FindQuery): Promise<string | undefined> {
    const { json } = await this.yesttp.get<{ id: string | undefined }>(`/containers/${containerId}/logs/find`, {
      searchParams: options,
    });
    return json.id;
  }

  public async list(containerId: string, options: LogService.ListQuery): Promise<LogService.ListResult> {
    const { json } = await this.yesttp.get<LogService.ListResult>(`/containers/${containerId}/logs`, {
      searchParams: options,
    });
    return LogService.ListResult.parse(json);
  }
}
