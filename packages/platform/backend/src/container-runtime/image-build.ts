import type { ImageBuildRequest, RuntimeFile } from "./contracts"
import { createHash } from "node:crypto"

export function immutableBase(reference: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(reference)) {
    throw new Error("Snapshot base image must be pinned by SHA256 digest")
  }
}

/**
 * The snapshot, not a fresh package resolution, is the input to every build.
 */
export function snapshotBuildFiles(request: ImageBuildRequest): RuntimeFile[] {
  immutableBase(request.baseImage)
  const files = request.files
  if (
    !files.some(file => file.path === "bun.lock") ||
    !files.some(file => file.path === "package.json")
  ) {
    throw new Error("Snapshot build requires a frozen Bun lockfile and package manifest")
  }

  if (files.some(file => file.secret || /(^|\/)Dockerfile$|(^|\/)\.npmrc$/.test(file.path))) {
    throw new Error("Snapshot context cannot contain credentials or override the Dockerfile")
  }

  const secretMount = request.secrets?.length
    ? "--mount=type=secret,id=npmrc,target=/root/.npmrc,required=true "
    : ""

  const compatibilityCheck = files.some(file => file.path === "highstate-compatibility.json")
    ? `RUN bun -e 'const c=await Bun.file("highstate-compatibility.json").json(); if(c.bunVersion!==Bun.version)throw new Error("Snapshot Bun version mismatch"); const p=Bun.spawnSync(["pulumi","version"]); if(p.exitCode!==0||p.stdout.toString().trim().replace(/^v/,"")!==c.pulumiVersion)throw new Error("Snapshot Pulumi version mismatch")'\n`
    : ""

  const manifest = JSON.parse(
    Buffer.from(files.find(file => file.path === "package.json")!.data).toString(),
  ) as { dependencies?: Record<string, string> }

  // bun deletes an empty lockfile and rejects it under --frozen-lockfile; an empty graph needs no install
  const install = Object.keys(manifest.dependencies ?? {}).length
    ? `RUN ${secretMount}bun install --frozen-lockfile --ignore-scripts\n`
    : ""

  const dockerfile = `# syntax=docker/dockerfile:1.7\nFROM ${request.baseImage}\nUSER root\nWORKDIR /opt/highstate/library\nCOPY . .\n${compatibilityCheck}${install}LABEL highstate.io/snapshot-hash=${JSON.stringify(request.snapshotHash)}\n`
  return [...files, { path: "Dockerfile", data: Buffer.from(dockerfile), mode: 0o644 }]
}

export function buildTag(request: ImageBuildRequest): string {
  const key = createHash("sha256")
    .update(
      `${request.owner.projectId}/${request.snapshotId}/${request.owner.workloadId}/${request.buildGeneration ?? request.owner.generation}`,
    )
    .digest("hex")

  return `${request.repository ?? "highstate-snapshot"}:${key}`
}
