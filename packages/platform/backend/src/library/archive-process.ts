import { spawn } from "node:child_process"

/**
 * Collects binary artifact output without passing an encoding to Bun's child-process streams.
 */
export async function runArchiveCommand(args: string[], cwd?: string): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const process = spawn("tar", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    const chunks: Buffer[] = []
    process.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    process.stderr.resume()
    process.on("error", reject)

    process.on("close", code => {
      if (code !== 0) {
        reject(new Error("Failed to read npm package archive protocol artifact"))
      } else {
        resolve(Buffer.concat(chunks))
      }
    })
  })
}
