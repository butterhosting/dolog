import { LogService } from "@/services/LogService";
import { Yesttp } from "yesttp";

export class LogClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async find(svcId: string, options: LogService.FindQuery): Promise<string | undefined> {
    const { json } = await this.yesttp.get<{ id: string | undefined }>(`/containers/${svcId}/logs/find`, {
      searchParams: options,
    });
    return json.id;
  }

  public async list(svcId: string, options: LogService.ListQuery): Promise<LogService.ListResult> {
    const { json } = await this.yesttp.get<LogService.ListResult>(`/containers/${svcId}/logs`, {
      searchParams: options,
    });
    return LogService.ListResult.parse(json);
  }
}
