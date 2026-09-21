import { expect, test } from "@playwright/test";
import { AppBoundary } from "./boundaries/AppBoundary";

test("all main pages load and have the right title", async ({ page }) => {
  // given
  type TestCase = {
    url: string;
    expectation: {
      title: string;
    };
  };
  const trickle = await AppBoundary.getSvc(page, "trickle");
  const testCases: TestCase[] = [
    {
      url: "",
      expectation: { title: "Services | Dolog" },
    },
    {
      url: "services",
      expectation: { title: "Services | Dolog" },
    },
    {
      url: `services/${trickle.id}/logs`,
      expectation: { title: "trickle | Dolog" },
    },
    {
      url: "configuration",
      expectation: { title: "Configuration | Dolog" },
    },
  ];
  for (const { url, expectation } of testCases) {
    // when
    await page.goto(url);
    // then
    await expect(page).toHaveTitle(expectation.title);
  }
});
