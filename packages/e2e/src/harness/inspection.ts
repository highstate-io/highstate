import type { startDesigner } from "./designer"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * Publishes the existing harness server for external browser tools until interrupted.
 */
export async function inspectDesigner(
  designer: Awaited<ReturnType<typeof startDesigner>>,
  projectIds: string[] = [],
  signal?: AbortSignal,
): Promise<void> {
  const manifest = {
    url: designer.url,
    directory: designer.directory,
    mode: designer.mode,
    projectIds,
  }

  await writeFile(join(designer.directory, "inspection.json"), JSON.stringify(manifest, null, 2))
  console.log(`Inspection Designer: ${designer.url}`)
  console.log(`Inspection manifest: ${join(designer.directory, "inspection.json")}`)

  console.log(
    "Open this URL in the OpenCode browser or another browser tool; the same server and database remain active until interrupted.",
  )

  if (signal) {
    if (!signal.aborted) {
      await new Promise<void>(resolve =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      )
    }

    return
  }

  await new Promise<void>(resolve => {
    const finish = () => {
      process.off("SIGINT", finish)
      process.off("SIGTERM", finish)
      resolve()
    }

    process.once("SIGINT", finish)
    process.once("SIGTERM", finish)
  })
}
