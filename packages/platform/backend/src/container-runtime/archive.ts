import type { RuntimeFile } from "./contracts"
import { posix } from "node:path"
import { pack } from "tar-stream"

/**
 * Creates a portable archive without reading paths on the backend host.
 */
export async function archiveFiles(files: RuntimeFile[]): Promise<Buffer> {
  const archive = pack()
  const chunks: Buffer[] = []

  const reading = (async () => {
    for await (const chunk of archive) {
      chunks.push(Buffer.from(chunk as Uint8Array))
    }
  })()

  for (const file of files) {
    const name = file.path.replace(/^\/+/, "")
    if (!name || posix.normalize(name) !== name || name.startsWith("../") || name.includes("\0")) {
      throw new Error(`Invalid runtime file path "${file.path}"`)
    }

    await new Promise<void>((resolve, reject) =>
      archive.entry(
        {
          name,
          mode: file.mode ?? 0o600,
          size: file.data.byteLength,
          mtime: new Date(0),
          uid: file.uid ?? 0,
          gid: file.gid ?? 0,
        },
        Buffer.from(file.data),
        error => (error ? reject(error) : resolve()),
      ),
    )
  }

  archive.finalize()
  await reading
  return Buffer.concat(chunks)
}
