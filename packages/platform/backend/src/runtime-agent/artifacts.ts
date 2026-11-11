import type { UnitArtifact } from "@highstate/contract"
import { createReadStream, createWriteStream } from "node:fs"
import { connect } from "node:http2"
import { finished, pipeline } from "node:stream/promises"

/**
 * Transfers action-scoped artifacts over the runtime listener's authenticated HTTP/2 TLS connection.
 */
export async function transferArtifact(
  url: string,
  path: string,
  declaration?: UnitArtifact,
): Promise<void> {
  const endpoint = new URL(url)
  const session = connect(endpoint.origin, { ca: process.env.HIGHSTATE_AGENT_CA })
  session.setTimeout(60_000, () => session.destroy(new Error("Artifact transfer timed out")))

  const request = session.request({
    ":method": declaration ? "PUT" : "GET",
    ":path": endpoint.pathname,
    ...(declaration ? { "x-highstate-artifact": JSON.stringify(declaration) } : {}),
  })

  const status = new Promise<void>((resolve, reject) => {
    session.once("error", reject)
    request.once("error", reject)

    request.once("response", headers => {
      if (headers[":status"] === 200) {
        resolve()
      } else {
        let detail = ""

        request.on("data", chunk => {
          detail = (detail + chunk.toString()).slice(0, 4096)
        })

        request.once("end", () => {
          reject(new Error(`Artifact transfer returned HTTP ${headers[":status"]}: ${detail}`))
        })

        request.resume()
      }
    })
  })

  // retain the failure until both upload and response observation can settle
  void status.catch(() => {})

  try {
    if (declaration) {
      request.resume()
      await pipeline(createReadStream(path), request)
      await status
      await finished(request)
    } else {
      request.end()
      await status
      await pipeline(request, createWriteStream(path))
    }
  } catch (error) {
    throw new Error(`Failed to ${declaration ? "upload" : "download"} runtime artifact: ${error}`, {
      cause: error,
    })
  } finally {
    request.destroy()
    session.destroy()
  }
}
