import { expect, Page } from "@playwright/test";

export namespace AppBoundary {
  type Svc = {
    id: string;
    dname: string;
  };
  export async function svc(page: Page, dname: string): Promise<Svc> {
    let svc: Svc | undefined;
    // a service only exists once its container has been seen, which can trail the app coming up
    await expect(async () => {
      const response = await page.request.get("/internal-api/svcs", { failOnStatusCode: true });
      svc = ((await response.json()) as Svc[]).find((svc) => svc.dname === dname);
      expect(svc).toBeDefined();
    }).toPass();
    return svc!;
  }
}
