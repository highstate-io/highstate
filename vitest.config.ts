import { defineConfig } from "vitest/config"

const zodShimPath = Bun.fileURLToPath(new URL("./scripts/vitest.zod-shim.ts", import.meta.url))

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["json"],
    },
    testTimeout: 60_000,
    isolate: false,
  
  },
  resolve: {
    alias: [
      {
        find: /^zod$/,
        replacement: zodShimPath,
      },
    ],
  },
})
