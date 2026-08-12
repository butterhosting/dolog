import { LogService } from "@/services/LogService";
import { Yesttp } from "yesttp";

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
