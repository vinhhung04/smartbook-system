import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  baseURL: 'http://localhost:5173',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
