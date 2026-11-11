// Local-only: this machine has chromium 1248, not the build Playwright expects.
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1248/chrome-win64/chrome.exe` } } }],
});
