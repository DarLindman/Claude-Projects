'use strict';

const { defineConfig, devices } = require('@playwright/test');

const PORT = 3100;

// Browser tests live in test/e2e and are matched only by *.spec.js, so
// `node --test` (which globs test/api) never picks them up.
module.exports = defineConfig({
  testDir: 'test/e2e',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: 'node test/e2e/server.js',
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
