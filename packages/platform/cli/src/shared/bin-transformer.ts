import type { Plugin } from "esbuild"
import { readFile } from "node:fs/promises"
import { logger } from "./logger"

export function createBinTransformerPlugin(sourceFilePaths: string[]): Plugin {
  const filter = new RegExp(`(${sourceFilePaths.join("|")})$`)

  logger.debug("created bin transformer plugin with filter: %s", filter)

  return {
    name: "bin-transformer",
    setup(build) {
      build.onLoad({ filter }, async args => {
        const content = await readFile(args.path, "utf-8")

        return {
          contents: `#!/usr/bin/env node\n\n${content}`,
          loader: "ts",
        }
      })
    },
  }
}
