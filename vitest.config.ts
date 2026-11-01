import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: { NODE_ENV: 'test' },
    // Los tests de integración comparten la misma base de datos.
    fileParallelism: false,
  },
})
