import type { NpmRegistryAccess, ProjectNpmRegistryProvider } from "./npm"
import { z } from "zod"
import { exactPackageVersionSchema, npmPackageNameSchema } from "./project-types"

export const packageSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    scope: z.string().max(214).default(""),
    offset: z.number().int().min(0).max(1000).default(0),
  })
  .strict()

const summarySchema = z.object({
  name: npmPackageNameSchema,
  version: z.string().optional(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
})

export type NpmPackageSummary = z.infer<typeof summarySchema>
export type NpmRegistryOption = { scope: string; registryUrl: string }
export type NpmPackageSearch = { packages: NpmPackageSummary[]; total: number; searchable: boolean }
export type NpmPackageInfo = {
  name: string
  description?: string
  readme?: string
  homepage?: string
  license?: string
  tags: Record<string, string>
  versions: { version: string; publishedAt?: string; deprecated?: string }[]
}

export async function registryScopes(
  provider: ProjectNpmRegistryProvider,
  projectId: string,
): Promise<Record<string, NpmRegistryAccess>> {
  return {
    "": await provider.forPackage(projectId, "highstate"),
    ...(await provider.scopes?.(projectId)),
  }
}

async function request(access: NpmRegistryAccess, path: string) {
  const base = new URL(access.registryUrl)

  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  ) {
    throw new Error("Registry URL must be HTTP(S), without credentials, query, or fragment")
  }

  return await fetch(`${base.href.replace(/\/$/, "")}/${path}`, {
    headers: access.token ? { authorization: `Bearer ${access.token}` } : {},
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  })
}

export async function getNpmPackageInfo(
  provider: ProjectNpmRegistryProvider,
  projectId: string,
  packageName: string,
): Promise<NpmPackageInfo> {
  npmPackageNameSchema.parse(packageName)
  const access = await provider.forPackage(projectId, packageName)
  const response = await request(access, encodeURIComponent(packageName))

  if (!response.ok) {
    throw new Error(`Package lookup failed (${response.status})`)
  }

  const document = z
    .object({
      name: npmPackageNameSchema,
      description: z.string().optional(),
      readme: z.string().optional(),
      homepage: z.string().optional(),
      license: z.string().optional(),
      "dist-tags": z.record(z.string(), z.string()).default({}),
      time: z.record(z.string(), z.string()).default({}),
      versions: z.record(z.string(), z.object({ deprecated: z.string().optional() })),
    })
    .parse(await response.json())

  if (document.name !== packageName) {
    throw new Error("Registry package identity mismatch")
  }

  return {
    name: document.name,
    description: document.description,
    readme: document.readme,
    homepage: document.homepage,
    license: document.license,
    tags: document["dist-tags"],
    versions: Object.entries(document.versions)
      .filter(([version]) => exactPackageVersionSchema.safeParse(version).success)
      .map(([version, metadata]) => ({
        version,
        publishedAt: document.time[version],
        deprecated: metadata.deprecated,
      }))
      .reverse(),
  }
}

export async function searchNpmPackages(
  provider: ProjectNpmRegistryProvider,
  projectId: string,
  input: z.infer<typeof packageSearchInputSchema>,
): Promise<NpmPackageSearch> {
  const { query, scope, offset } = packageSearchInputSchema.parse(input)
  const scopes = await registryScopes(provider, projectId)
  const access = scopes[scope]

  if (!access) {
    throw new Error("Registry scope is not configured for this project's runtime")
  }

  const params = new URLSearchParams({ text: query, size: "25", from: String(offset) })
  const response = await request(access, `-/v1/search?${params}`)

  if ([404, 405, 501].includes(response.status)) {
    if (!npmPackageNameSchema.safeParse(query).success) {
      return { packages: [], total: 0, searchable: false }
    }

    const routed = await provider.forPackage(projectId, query)
    if (routed.registryUrl !== access.registryUrl) {
      return { packages: [], total: 0, searchable: false }
    }

    const exact = await request(access, encodeURIComponent(query))
    if (exact.status === 404) {
      return { packages: [], total: 0, searchable: false }
    }

    if (!exact.ok) {
      throw new Error(`Package lookup failed (${exact.status})`)
    }

    const document = summarySchema.parse(await exact.json())
    if (document.name !== query) {
      throw new Error("Registry package identity mismatch")
    }

    return { packages: [document], total: 1, searchable: false }
  }

  if (!response.ok) {
    throw new Error(`Registry search failed (${response.status})`)
  }

  const result = z
    .object({
      objects: z.array(z.object({ package: summarySchema })).max(250),
      total: z.number().nonnegative(),
    })
    .parse(await response.json())

  const packages: NpmPackageSummary[] = []

  for (const item of result.objects) {
    const routed = await provider.forPackage(projectId, item.package.name)
    if (routed.registryUrl === access.registryUrl) {
      packages.push(item.package)
    }
  }

  return { packages, total: result.total, searchable: true }
}
