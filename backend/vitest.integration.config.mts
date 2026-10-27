import { defineConfig } from 'vitest/config'

// Integration tests talk to a real MySQL, so they run separately from the unit tests (`npm run test:integration`).
// The database comes from TEST_DATABASE_URL and `src/test/integration-setup.ts` refuses anything that is not a `*_test` database,
// so a developer's data can never be wiped by a mistaken URL.
const databaseUrl = process.env.TEST_DATABASE_URL

if (!databaseUrl) {
  throw new Error('Set TEST_DATABASE_URL to a throwaway MySQL database whose name ends in _test, with the migrations applied.')
}

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    environment: 'node',
    setupFiles: ['src/test/integration-setup.ts'],
    // All files share one database, so they run one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: databaseUrl,
      FRONTEND_URL: 'http://localhost:5173',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdefghij',
      TOKEN_ENCRYPTION_KEY: 'test-encryption-key-0123456789abcdefgh',
      ACCESS_TOKEN_TTL_SECONDS: '900',
      TRUST_PROXY: '0',
    },
  },
})
