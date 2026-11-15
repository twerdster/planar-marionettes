import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  outputDir: process.env.PUPPIFY_QA_OUTPUT_DIR ?? 'test-results',
  reporter: process.env.PUPPIFY_QA_REPORT
    ? [['list'], ['json', { outputFile: process.env.PUPPIFY_QA_REPORT }]]
    : [['list']],
  use: {
    baseURL: process.env.PUPPIFY_QA_BASE_URL ?? 'http://127.0.0.1:18791',
    // Local checks use installed Chrome in a fresh profile; CI uses Playwright's Chromium.
    channel: process.env.CI ? undefined : 'chrome',
    serviceWorkers: 'block',
    acceptDownloads: true,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  projects: [
    { name: 'desktop-chrome', use: { viewport: { width: 1440, height: 1100 } } },
    {
      name: 'mobile-chrome-emulation',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
    },
  ],
});
