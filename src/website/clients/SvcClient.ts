import { Svc } from "@/models/Svc";
import { Yesttp } from "yesttp";

export class SvcClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async list(): Promise<Svc[]> {
    const { json } = await this.yesttp.get<unknown[]>("/svcs");
    return json.map(Svc.parse);
  }
}
