import { ContainerRM } from "@/models/ContainerRM";
import { Yesttp } from "yesttp";

/** The container overview. Everything under `/containers/:id/logs` belongs to `LogClient` instead. */
export class ContainerClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async list(): Promise<ContainerRM[]> {
    const { json } = await this.yesttp.get<unknown[]>("/containers");
    return json.map(ContainerRM.parse);
  }
}
