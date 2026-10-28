import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // The grades worker has its own install and runs on Cloudflare; its pure logic is tested from lib/fantasy/__tests__.
    // The live accuracy suite reads Sleeper's API on its own schedule: npm run test:accuracy.
    exclude: [...configDefaults.exclude, 'workers/**', 'tests/accuracy/**'],
  },
})
