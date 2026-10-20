import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // integration tests share one chain + one API instance; run files serially
    fileParallelism: false,
  },
})
