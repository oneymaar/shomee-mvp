import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 180_000,   // 3 min — IRIS data loading from network takes ~20-30s
    hookTimeout: 60_000,
    reporters: ['verbose'],
  },
  resolve: {
    // Resolve the package self-reference to source so tests exercise the
    // same modules consumers import (@shomee/core/geo/x → src/geo/x).
    alias: { '@shomee/core': resolve(__dirname, 'src') },
  },
})
