import type { ImageIdentity, RegistryCredential } from "./contracts"
import { createHash } from "node:crypto"

export type RegistryConfig = { credentials?: RegistryCredential[]; allowHttp?: boolean }

export class RegistryResponseError extends Error {
  constructor(readonly status: number) {
    super(`Registry request failed (${status})`)
  }
}

/**
 * OCI Distribution client with scoped bearer-token challenge support.
 */
export class ImageRegistry {
  constructor(private readonly config: RegistryConfig = {}) {}

  private parse(reference: string) {
    const parts = reference.split("/")
    const first = parts[0] ?? ""
    const explicit = first.includes(".") || first.includes(":") || first === "localhost"
    const registry = explicit ? parts.shift()! : "docker.io"
    const path = parts.join("/")
    const match = /^(.*?)(?:@([^@]+)|:([^/:]+))?$/.exec(path)!

    const repository =
      registry === "docker.io" && !match[1]!.includes("/") ? `library/${match[1]}` : match[1]!

    return {
      registry,
      repository,
      selector: match[2] ?? match[3] ?? "latest",
      host: registry === "docker.io" ? "registry-1.docker.io" : registry,
    }
  }

  private async request(reference: string, path: string, signal?: AbortSignal): Promise<Response> {
    const image = this.parse(reference)

    const credential = this.config.credentials?.find(
      item => item.serveraddress.replace(/^https?:\/\//, "").replace(/\/$/, "") === image.registry,
    )

    const headers: Record<string, string> = {
      Accept:
        "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
    }

    if (credential) {
      headers.Authorization = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`
    }

    const url = `${this.config.allowHttp ? "http" : "https"}://${image.host}/v2/${image.repository}/${path}`
    let response = await fetch(url, { headers, signal })
    if (response.status === 401) {
      const challenge = response.headers.get("www-authenticate") ?? ""
      if (!challenge.startsWith("Bearer ")) {
        throw new Error("Registry rejected credentials")
      }

      const params = Object.fromEntries(
        [...challenge.matchAll(/(\w+)="([^"]*)"/g)].map(match => [match[1], match[2]]),
      )

      const tokenUrl = new URL(params.realm!)
      if (tokenUrl.protocol !== "https:" && !this.config.allowHttp) {
        throw new Error("Registry token service requires TLS")
      }

      tokenUrl.searchParams.set("service", params.service ?? image.registry)
      tokenUrl.searchParams.set("scope", `repository:${image.repository}:pull`)

      const tokenResponse = await fetch(tokenUrl, {
        headers: credential ? { Authorization: headers.Authorization! } : {},
        signal,
      })

      if (!tokenResponse.ok) {
        throw new Error(`Registry token request failed (${tokenResponse.status})`)
      }

      const token = (await tokenResponse.json()) as { token?: string; access_token?: string }
      headers.Authorization = `Bearer ${token.token ?? token.access_token}`
      response = await fetch(url, { headers, signal })
    }

    if (!response.ok) {
      throw new RegistryResponseError(response.status)
    }

    return response
  }

  async inspect(reference: string, signal?: AbortSignal): Promise<ImageIdentity> {
    const image = this.parse(reference)
    const response = await this.request(reference, `manifests/${image.selector}`, signal)
    const bytes = Buffer.from(await response.arrayBuffer())
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    if (image.selector.startsWith("sha256:") && digest !== image.selector) {
      throw new Error("Registry manifest digest mismatch")
    }

    const manifest = JSON.parse(bytes.toString()) as {
      config?: { digest: string }
      manifests?: { digest: string }[]
    }

    let imageHash = ""

    if (manifest.config) {
      const configResponse = await this.request(
        reference,
        `blobs/${manifest.config.digest}`,
        signal,
      )

      const configBytes = Buffer.from(await configResponse.arrayBuffer())
      if (
        `sha256:${createHash("sha256").update(configBytes).digest("hex")}` !==
        manifest.config.digest
      ) {
        throw new Error("Registry config digest mismatch")
      }

      const config = JSON.parse(configBytes.toString()) as {
        config?: { Labels?: Record<string, string> }
      }

      imageHash = config.config?.Labels?.["highstate.io/snapshot-hash"] ?? ""
    } else if (manifest.manifests?.length) {
      const children = await Promise.all(
        manifest.manifests.map(child =>
          this.inspect(`${image.registry}/${image.repository}@${child.digest}`, signal),
        ),
      )

      imageHash = children[0]!.imageHash

      if (children.some(child => child.imageHash !== imageHash)) {
        throw new Error("Multi-platform image snapshot hashes differ")
      }
    } else {
      throw new Error("Unsupported registry image manifest")
    }

    return { reference: `${image.registry}/${image.repository}@${digest}`, digest, imageHash }
  }
}
