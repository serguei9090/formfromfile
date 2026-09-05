import { defineConfig, devices } from '@playwright/test'

// Separate from playwright.config.ts on purpose: this isn't a test suite, it
// generates the README demo (screenshots + a recorded video). Not run by
// `bun run e2e` or CI — see `bun run demo`.
export default defineConfig({
  testDir: './e2e-demo',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:5273',
    viewport: { width: 1280, height: 800 },
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node e2e/api-server.mjs',
      url: 'http://localhost:8787/healthz',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'bun run dev',
      url: 'http://localhost:5273',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
