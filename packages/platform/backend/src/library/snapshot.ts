import type { LibraryModel } from "../shared"
import type { LibrarySnapshotContent, ResolvedLibraryPackage } from "./project-types"
import { createHash } from "node:crypto"
import { z } from "zod"
import { exactPackageVersionSchema, npmPackageNameSchema } from "./project-types"

/** Includes omitted implementation roots; selectedPackages alone is not the frozen install manifest. */
export function getFrozenSnapshotPackageJson(snapshot: Pick<LibrarySnapshotContent, "lockfile">): {
  name: string
  private: true
  dependencies: Record<string, string>
} {
  const lockfile = z
    .object({
      workspaces: z.record(
        z.string(),
        z.object({
          dependencies: z.record(npmPackageNameSchema, exactPackageVersionSchema).optional(),
        }),
      ),
    })
    .parse(JSON.parse(snapshot.lockfile.replace(/,\s*([}\]])/g, "$1")))
  const dependencies = lockfile.workspaces[""]?.dependencies
  if (!lockfile.workspaces[""]) throw new Error("Frozen lockfile has no root workspace")
  return { name: "highstate-snapshot", private: true, dependencies: dependencies ?? {} }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function snapshotHash(content: LibrarySnapshotContent): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        model: content.model,
        sourceManifest: content.sourceManifest,
        compatibility: content.compatibility,
        lockfile: JSON.parse(content.lockfile.replace(/,\s*([}\]])/g, "$1")),
        selectedPackages: content.selectedPackages
          .map(({ packageName, version }) => ({ packageName, version }))
          .toSorted((a, b) => (a.packageName < b.packageName ? -1 : 1)),
        packages: content.packages
          .map(pkg => ({
            packageName: pkg.packageName,
            version: pkg.version,
            packageIntegrity: pkg.packageIntegrity,
            model: pkg.model,
            sourceManifest: pkg.sourceManifest,
          }))
          .toSorted((a, b) => (a.packageName < b.packageName ? -1 : 1)),
      }),
    )
    .digest("hex")
}

export function mergeLibraryPackages(
  packages: ResolvedLibraryPackage[],
): Pick<LibrarySnapshotContent, "model" | "sourceManifest"> {
  const model: LibraryModel = { components: {}, entities: {} }
  const owners: Record<string, string> = {}
  const manifests: LibrarySnapshotContent["sourceManifest"]["packages"] = {}
  for (const pkg of packages) {
    manifests[pkg.packageName] = pkg.sourceManifest
    for (const collection of ["components", "entities"] as const) {
      for (const [type, definition] of Object.entries(pkg.model[collection])) {
        const key = `${collection}:${type}`
        if (Object.hasOwn(model[collection], type))
          throw new Error(
            `Duplicate ${collection} type "${type}" from "${owners[key]}" and "${pkg.packageName}"`,
          )
        Object.defineProperty(model[collection], type, {
          value: definition,
          enumerable: true,
          configurable: true,
          writable: true,
        })
        owners[key] = pkg.packageName
      }
    }
  }
  return { model, sourceManifest: { packages: manifests, owners } }
}
