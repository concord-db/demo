import { expect, test } from "@playwright/test";

test("O2 reveals recorded artifacts only after their producing operators execute", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#execution-status")).toHaveText("0 of 7 operators complete");
  await expect(page.locator(".operator-step[data-status='locked']")).toHaveCount(6);
  await expect(page.locator(".retained-meter")).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".source-facade")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator(".retained-meter")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".candidate-rationale")).toContainText("Candidate evidence");
  await expect(page.locator(".transcript-segment.candidate").first()).toBeVisible();
  await expect(page.locator(".retained-meter")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator("[aria-label='Padded source window']")).toBeVisible();
  await expect(page.locator(".retained-meter")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator("[aria-label='Resolved retained window']")).toBeVisible();
  await expect(page.locator(".retained-meter")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".retained-meter")).toContainText("2.47%");
  await expect(page.locator("video")).toHaveAttribute("src", "./media/soap-bubble-candidate-v1.mp4");
  await expect(page.locator(".prediction-card")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".prediction-card")).toHaveCount(3);
  await expect(page.locator(".detail-marker.prediction")).toHaveCount(3);
  await expect(page.locator(".prediction-card").first()).toContainText("clip time");

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".prediction-card")).toHaveCount(3);
  await expect(page.locator(".prediction-card").first()).toContainText("source time");
  await expect(page.locator("#execution-status")).toContainText("Execution complete");
});

test("full lecture loading is explicit and uses the privacy-enhanced player", async ({ page }) => {
  await page.goto("/");
  await page.locator("#run-next-stage").click();
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.getByRole("button", { name: "Load full lecture" }).click();
  await expect(page.locator("iframe")).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/VkbtIDSHfSc/);
});

test("video fraction is operator-scoped across all three alternatives", async ({ page }) => {
  await page.goto("/");
  await page.locator("#tab-baseline").click();
  await page.locator("#run-next-stage").click();
  await expect(page.locator(".retained-meter")).toHaveCount(0);
  await page.locator("#run-next-stage").click();
  await expect(page.locator(".retained-meter")).toContainText("100.00%");

  await page.locator("#tab-o1").click();
  for (let index = 0; index < 3; index += 1) await page.locator("#run-next-stage").click();
  await expect(page.locator(".retained-meter")).toHaveCount(0);
});

test("operator trace remains within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#run-next-stage").click();
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
});
