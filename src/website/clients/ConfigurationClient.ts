import { Configuration } from "@/models/Configuration";
import { Yesttp } from "yesttp";

export class ConfigurationClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async get(): Promise<Configuration> {
    const { json } = await this.yesttp.get<unknown>("/configuration");
    return Configuration.parse(json);
  }
}
