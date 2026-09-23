import { Page } from "@playwright/test";

export namespace WebhooksBoundary {
  const RECEIVED_URL = "http://localhost:3001/received";

  type Alert = {
    object: "alert";
    type: "text" | "throughput";
    service: { dname: string };
    match?: { pattern: string; line: string };
    breach?: { threshold: number; logsPerSecond: number };
  };

  export async function received(page: Page): Promise<Alert[]> {
    const response = await page.request.get(RECEIVED_URL, { failOnStatusCode: true });
    return (await response.json()) as Alert[];
  }
}
