// Тесты интерфейса: страница из public/ на маленьком статическом сервере,
// API подменяется в самих тестах, телефон с Android-приложением — эмуляцией (см. tests/ui/app.mjs).
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/ui',
  testMatch: '*.spec.mjs',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Локально — установленный Chrome (браузер Playwright качать не нужно), в CI — свой.
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'android', use: { ...devices['Pixel 7'], channel: process.env.CI ? undefined : 'chrome' } },
  ],
  webServer: {
    command: `node tests/ui/serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
