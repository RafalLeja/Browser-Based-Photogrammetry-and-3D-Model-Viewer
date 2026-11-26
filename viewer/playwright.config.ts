import { defineConfig, devices } from '@playwright/test';

// Locally an installed Chromium browser is used, so nothing is downloaded: Edge on Windows,
// Chrome elsewhere, or PW_CHANNEL. CI installs Playwright's own Chromium instead.
const channel = process.env.CI ? undefined : (process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'));

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false, // The tests share one API and database.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel,
        viewport: { width: 1440, height: 900 },
        // Software WebGL, so the 3D view also renders on machines and CI runners without a GPU.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: 'http://127.0.0.1:8010/api/v1/health',
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --port 5180 --strictPort',
      url: 'http://localhost:5180',
      env: { VITRINE_API: 'http://127.0.0.1:8010' },
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
