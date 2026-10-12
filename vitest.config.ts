import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    // The grades worker has its own install and runs on Cloudflare; its pure logic is tested from lib/fantasy/__tests__.
    exclude: [...configDefaults.exclude, 'workers/**'],
  },
})
