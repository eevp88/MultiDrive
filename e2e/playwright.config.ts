import { defineConfig, devices } from '@playwright/test'

// The stack comes from `npm run stack:up` (docker-compose.yml in this folder): frontend on 15173, API on 14000.
export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:15173'
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:14000'

export default defineConfig({
  testDir: './tests',
  // One shared database and an API rate limit on register, so the tests run one after another.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    // The UI picks its language from the browser, and the tests read English labels.
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' }, dependencies: ['setup'], testIgnore: /auth\.setup\.ts|public\..*\.spec\.ts/ },
    { name: 'chromium-anonymous', use: { ...devices['Desktop Chrome'] }, testMatch: /public\..*\.spec\.ts/ },
  ],
})
