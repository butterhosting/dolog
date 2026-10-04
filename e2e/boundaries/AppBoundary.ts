import { APIRequestContext, expect, Page } from "@playwright/test";

export namespace AppBoundary {
  export async function purge(request: APIRequestContext): Promise<void> {
    await request.post("/internal-api/restricted/purge", { failOnStatusCode: true });
  }

  type Svc = {
    id: string;
    dname: string;
  };
  export async function getSvc(page: Page, dname: string): Promise<Svc> {
    let svc: Svc | undefined;
    await expect(async () => {
      const response = await page.request.get("/internal-api/svcs", { failOnStatusCode: true });
      svc = ((await response.json()) as Svc[]).find((svc) => svc.dname === dname);
      expect(svc).toBeDefined();
    }).toPass();
    return svc!;
  }

  type EnoughHistory = {
    svcId: string;
    events: number;
  };
  // waits for as long as the history keeps growing, since how fast a cpu-capped container logs depends on the host
  export async function ensureEnoughHistory(page: Page, { svcId, events }: EnoughHistory): Promise<void> {
    const STALL = 10_000;
    let seen = 0;
    let grewAt = Date.now();
    while (true) {
      const response = await page.request.get(`/internal-api/svcs/${svcId}/logs?limit=${events}`, { failOnStatusCode: true });
      const { data, hasOlder } = (await response.json()) as { data: unknown[]; hasOlder: boolean };
      if (hasOlder) return;
      if (data.length > seen) {
        seen = data.length;
        grewAt = Date.now();
      }
      expect(Date.now() - grewAt, `stopped logging at ${seen} of ${events} events`).toBeLessThan(STALL);
      await page.waitForTimeout(1_000);
    }
  }
}
