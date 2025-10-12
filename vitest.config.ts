import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["json"],
    },
    testTimeout: 60_000,
    isolate: false,
  },
})
