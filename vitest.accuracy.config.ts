import { defineConfig } from 'vitest/config'

// The live accuracy suite (tests/accuracy): it reads Sleeper's API, so it runs on its own schedule
// (npm run test:accuracy, .github/workflows/accuracy.yml) and never with the default suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/accuracy/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
})
