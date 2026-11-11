import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@highstate\/contract$/,
        replacement: fileURLToPath(new URL("../contract/src/index.ts", import.meta.url)),
      },
      {
        find: /^@highstate\/backend\/shared$/,
        replacement: fileURLToPath(new URL("../backend/src/shared/index.ts", import.meta.url)),
      },
      {
        find: /^@highstate\/backend$/,
        replacement: fileURLToPath(new URL("../backend/src/index.ts", import.meta.url)),
      },
    ],
  },
  test: { include: ["server/**/*.test.ts"], server: { deps: { inline: ["zod"] } } },
})
