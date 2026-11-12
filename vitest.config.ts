import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@ui': resolve(__dirname, 'src/renderer/src/ui'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'] }
})
