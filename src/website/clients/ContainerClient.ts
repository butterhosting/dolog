import { Throughput } from "@/models/Throughput";
import { Yesttp } from "yesttp";

export class ContainerClient {
  public constructor(private readonly yesttp: Yesttp) {}

  public async queryThroughput(): Promise<Throughput[]> {
    const { json } = await this.yesttp.get<unknown[]>("/containers/throughput");
    return json.map(Throughput.parse);
  }
}
