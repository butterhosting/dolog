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
    timeout: number;
  };
  export async function ensureEnoughHistory(page: Page, { svcId, events, timeout }: EnoughHistory): Promise<void> {
    await expect(async () => {
      const response = await page.request.get(`/internal-api/svcs/${svcId}/logs?limit=${events}`, { failOnStatusCode: true });
      expect(((await response.json()) as { hasOlder: boolean }).hasOlder).toBe(true);
    }).toPass({ timeout });
  }
}
