import { expect, test } from '@playwright/test'

test('replays the optimized query and exposes results', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /one highway/i })).toBeVisible()
  await page.getByRole('link', { name: /explore the replay/i }).click()
  await page.getByRole('button', { name: /replay query/i }).click()
  await expect(page.getByText(/\d+ records/)).toBeVisible({ timeout: 10_000 })
  await page.getByRole('tab', { name: /semantic query/i }).click()
  await expect(page.getByText(/Reduce∅/)).toBeVisible()
  await expect(page.getByRole('heading', { name: /better coverage/i })).toBeVisible()
})
