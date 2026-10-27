import { defineConfig } from 'vitest/config'

// `src/config/env.ts` validates process.env when it is first imported, so the variables are fixed here instead of read from a
// developer's .env: tests behave the same on every machine and never touch real secrets or databases.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    env: {
      DATABASE_URL: 'mysql://test:test@127.0.0.1:3306/multidrive_test',
      FRONTEND_URL: 'http://localhost:5173',
      JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdefghij',
      TOKEN_ENCRYPTION_KEY: 'test-encryption-key-0123456789abcdefgh',
      ACCESS_TOKEN_TTL_SECONDS: '900',
    },
  },
})
