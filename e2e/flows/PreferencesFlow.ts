import { expect, Page } from "@playwright/test";

export namespace PreferencesFlow {
  type SetHideStopped = {
    hideStopped: boolean;
  };
  export async function setHideStopped(page: Page, { hideStopped }: SetHideStopped): Promise<void> {
    await page.getByTitle("preferences").click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("checkbox").setChecked(hideStopped);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
}
