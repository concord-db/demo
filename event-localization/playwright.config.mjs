import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.e2e.mjs",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4175",
    headless: true,
  },
  webServer: {
    command: "python3 -m http.server 4175 --bind 127.0.0.1",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: true,
  },
});
