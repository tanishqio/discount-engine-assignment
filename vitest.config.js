// Test settings. A separate file so the dev server's local API plugin in vite.config.js isn't loaded.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    restoreMocks: true,
  },
})
