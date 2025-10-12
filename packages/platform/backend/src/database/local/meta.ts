import { readFile, writeFile } from "node:fs/promises"
import { parse, stringify } from "yaml"
import { z } from "zod"

const databaseMetaFileSchema = z.object({
  version: z.number(),
  masterKey: z.string().optional(),
})

export type DatabaseMetaFile = z.infer<typeof databaseMetaFileSchema>

export async function readMetaFile(
  databasePath: string,
): Promise<z.infer<typeof databaseMetaFileSchema> | undefined> {
  const metaFilePath = `${databasePath}/backend.meta.yaml`

  let content: string
  try {
    content = await readFile(metaFilePath, "utf-8")
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined
    }

    throw new Error(`Failed to read database meta file at "${metaFilePath}"`, { cause: error })
  }

  try {
    return databaseMetaFileSchema.parse(parse(content))
  } catch (error) {
    throw new Error(`Failed to parse database meta file at "${metaFilePath}"`, { cause: error })
  }
}

export async function writeMetaFile(
  databasePath: string,
  meta: z.infer<typeof databaseMetaFileSchema>,
): Promise<void> {
  const metaFilePath = `${databasePath}/backend.meta.yaml`

  try {
    await writeFile(metaFilePath, stringify(meta), "utf-8")
  } catch (error) {
    throw new Error(`Failed to write database meta file at "${metaFilePath}"`, { cause: error })
  }
}
