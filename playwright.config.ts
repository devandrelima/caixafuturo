import { defineConfig, devices } from '@playwright/test';

// E2E_BASE_URL: testa um app já publicado (ex.: container Docker). Sem ela, sobe o build local.
const externalBaseURL = process.env.E2E_BASE_URL;
const localPort = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: externalBaseURL ?? `http://127.0.0.1:${localPort}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run build && npx vite preview --host 127.0.0.1 --port ${localPort} --strictPort`,
        url: `http://127.0.0.1:${localPort}`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
