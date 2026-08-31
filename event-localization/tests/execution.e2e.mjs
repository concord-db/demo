import { expect, test } from "@playwright/test";

test("lecture O2 reveals artifacts only after their producing operators execute", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#example-title")).toHaveText("Lecture event localization");
  await expect(page.locator("#execution-status")).toHaveText("0 of 7 operators complete");
  await expect(page.locator(".operator-step[data-status='locked']")).toHaveCount(6);
  await expect(page.locator(".retained-meter")).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".source-facade")).toBeVisible();
  await expect(page.locator("iframe")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".candidate-rationale")).toContainText("Candidate evidence (1)");
  await expect(page.locator(".transcript-segment.candidate").first()).toBeVisible();

  await page.locator("#run-next-stage").click();
  await expect(page.locator("[aria-label='Padded source windows']")).toBeVisible();
  await page.locator("#run-next-stage").click();
  await expect(page.locator("[aria-label='Resolved retained windows']")).toBeVisible();

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".retained-meter")).toContainText("2.62%");
  const retainedPosition = await page.locator(".retained-meter-fill").evaluate((element) => ({
    left: parseFloat(element.style.left), width: parseFloat(element.style.width),
  }));
  expect(retainedPosition.left).toBeCloseTo(7.8, 1);
  expect(retainedPosition.width).toBeCloseTo(2.62, 1);
  await expect(page.locator("video")).toHaveAttribute("src", "./media/soap-bubble-candidate-v1.mp4");
  await expect(page.locator(".prediction-card")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".prediction-card")).toHaveCount(3);
  await expect(page.locator(".prediction-card button")).toHaveCount(3);
  await expect(page.locator(".detail-marker.prediction")).toHaveCount(3);
  await expect(page.locator(".prediction-card").first()).toContainText("clip time");

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".prediction-card")).toHaveCount(3);
  await expect(page.locator(".prediction-card button")).toHaveCount(0);
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

test("soccer uses the shared trace with points, three windows, and honest media fallback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Soccer" }).click();
  await expect(page.locator("#example-title")).toHaveText("Soccer goal localization");
  await expect(page.locator("#example-query")).toContainText("source-time timestamp");
  await expect(page.locator("#metric-video")).toHaveText("5.32%");
  await expect(page.locator("#metric-f1")).toHaveText(".952");
  await expect(page.locator("#metric-f1-note")).toHaveText("at ±30 s tolerance");
  await expect(page.locator("#execution-status")).toHaveText("0 of 7 operators complete");

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".source-unavailable")).toContainText("not redistributed");
  await expect(page.locator("video, iframe")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".candidate-rationale")).toContainText("Candidate evidence (3)");
  await expect(page.locator(".transcript-segment.candidate")).toHaveCount(3);
  await page.locator("#run-next-stage").click();
  await expect(page.locator(".timeline-window")).toHaveCount(3);
  await page.locator("#run-next-stage").click();
  await expect(page.locator(".timeline-window")).toHaveCount(3);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".clip-selector button")).toHaveCount(3);
  await expect(page.locator(".retained-meter-fill")).toHaveCount(3);
  await expect(page.locator(".retained-meter")).toContainText("6.67%");
  await expect(page.locator(".media-fallback")).toContainText("not redistributed");
  await expect(page.locator("video")).toHaveCount(0);

  await page.locator("#run-next-stage").click();
  await expect(page.locator(".prediction-card")).toHaveCount(3);
  await expect(page.locator(".prediction-card button")).toHaveCount(0);
  await expect(page.locator(".prediction-card").first()).toContainText("0:29.5 clip time");
  await page.locator("#run-next-stage").click();
  await expect(page.locator(".prediction-card").first()).toContainText("16:17.5 source time");
});

test("switching examples preserves the query alternative and resets execution", async ({ page }) => {
  await page.goto("/");
  await page.locator("#tab-o1").click();
  await page.locator("#run-next-stage").click();
  await expect(page.locator("#execution-status")).toHaveText("1 of 3 operators complete");
  await page.getByRole("tab", { name: "Soccer" }).click();
  await expect(page.locator("#tab-o1")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#execution-status")).toHaveText("0 of 3 operators complete");
  await page.getByRole("tab", { name: "Lecture" }).click();
  await expect(page.locator("#tab-o1")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#execution-status")).toHaveText("0 of 3 operators complete");
});

test("video fraction is operator-scoped across all three alternatives", async ({ page }) => {
  await page.goto("/");
  await page.locator("#tab-baseline").click();
  await page.locator("#run-next-stage").click();
  await expect(page.locator(".retained-meter")).toHaveCount(0);
  await page.locator("#run-next-stage").click();
  await expect(page.locator(".retained-meter")).toContainText("100.00%");
  await expect(page.locator(".prediction-card button")).toHaveCount(0);
  await page.locator("#tab-o1").click();
  for (let index = 0; index < 3; index += 1) await page.locator("#run-next-stage").click();
  await expect(page.locator(".retained-meter")).toHaveCount(0);
});

test("both examples remain within a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (const name of ["Lecture", "Soccer"]) {
    await page.getByRole("tab", { name }).click();
    await page.locator("#run-next-stage").click();
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
});
