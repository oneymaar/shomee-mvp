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
    alias: { '@': resolve(__dirname, '.') },
  },
})
