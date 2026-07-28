import { defineConfig, devices } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local Supabase Auth under this project's parallel test load occasionally
  // makes a real signup take unusually long (confirmed via server logs: the
  // POST does eventually 303-redirect, just not always within the test's
  // window) - one retry absorbs that without masking a real regression,
  // which would fail the retry too, not just the first attempt.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // This app is mobile-first — every smoke test also runs at a narrow
      // (~375px) viewport, per CLAUDE.md's mobile UI review requirement.
      // Plain Chromium with a custom viewport (not a real device preset,
      // and deliberately without isMobile/hasTouch): Chromium's mobile
      // emulation without a matching deviceScaleFactor produces a
      // layout-viewport vs. visual-viewport mismatch that offsets click
      // coordinates by tens of pixels — a Chromium emulation quirk, not
      // something worth chasing for a "does this fit at 375px" check.
      name: "mobile-375",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 667 },
      },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
