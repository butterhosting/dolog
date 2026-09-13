import { Host } from "@/models/Host";
import { Yesttp } from "yesttp";

export class HostClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async get(): Promise<Host> {
    const { json } = await this.yesttp.get<unknown>("/host");
    return Host.parse(json);
  }
}
