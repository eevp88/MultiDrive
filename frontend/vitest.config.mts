import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Kept apart from vite.config.ts on purpose: tests do not need the PWA plugin, and the aliases below must match it.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    restoreMocks: true,
    // The API base URL is fixed so no test depends on a developer's .env.
    env: { VITE_API_URL: 'http://api.test' },
  },
})
