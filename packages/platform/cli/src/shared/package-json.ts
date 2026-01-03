import { writeFile } from "node:fs/promises"

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  const contents = `${JSON.stringify(value, null, 2)}\n`
  await writeFile(filePath, contents, "utf8")
}
