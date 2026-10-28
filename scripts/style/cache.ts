import { createHash } from "node:crypto"

export async function fingerprintFiles(paths: string[]): Promise<string> {
  const hash = createHash("sha256")

  for (const path of [...paths].sort()) {
    hash.update(path)
    hash.update("\0")
    hash.update(Buffer.from(await Bun.file(path).arrayBuffer()))
    hash.update("\0")
  }

  return hash.digest("hex")
}
