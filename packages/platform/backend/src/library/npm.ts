import type { LibraryCompatibility, SelectedLibraryPackage } from "@highstate/contract"
import type { LibraryModel } from "../shared"
import { createHash, timingSafeEqual } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isUnitModel } from "@highstate/contract"
import { decode } from "@msgpack/msgpack"
import { execa } from "execa"
import { z } from "zod"
import { runArchiveCommand } from "./archive-process"
import {
  libraryCompatibilitySchema,
  libraryModelSchema,
  librarySourceManifestSchema,
} from "./project-schemas"
import {
  exactPackageVersionSchema,
  type LibrarySnapshotContent,
  libraryPackageVersionDetailsSchema as metadataSchema,
  npmPackageNameSchema,
  type ProjectLibraryResolver,
  type ProjectLibrarySnapshot,
  type ResolvedLibraryPackage,
  selectedLibraryPackagesSchema,
} from "./project-types"
import { getFrozenSnapshotPackageJson, mergeLibraryPackages, snapshotHash } from "./snapshot"

export type NpmRegistryAccess = { registryUrl: string; token?: string }
/**
 * The provider must select credentials from the project's selected runtime, never all backend credentials.
 */
export interface ProjectNpmRegistryProvider {
  forPackage(projectId: string, packageName: string): Promise<NpmRegistryAccess>
  /**
   * All scope mappings available to this project's runtime, including transitive dependency scopes.
   */
  scopes?(projectId: string): Promise<Record<string, NpmRegistryAccess>>
}

export class IncompatibleLibraryPackageError extends Error {}

export function verifyPackageIntegrity(bytes: Uint8Array, integrity: string): void {
  const candidates = integrity
    .split(/\s+/)
    .map(value => /^(sha512|sha384|sha256)-([A-Za-z0-9+/]+={0,2})$/.exec(value))
    .filter(value => value !== null)

  const algorithm = ["sha512", "sha384", "sha256"].find(name =>
    candidates.some(value => value[1] === name),
  )

  if (!algorithm) {
    throw new Error("Package has no supported integrity digest")
  }

  const actual = createHash(algorithm).update(bytes).digest()
  if (
    !candidates.some(value => {
      if (value[1] !== algorithm) {
        return false
      }

      const expected = Buffer.from(value[2]!, "base64")
      return expected.length === actual.length && timingSafeEqual(actual, expected)
    })
  ) {
    throw new Error("Package archive integrity mismatch")
  }
}

export class NpmProjectLibraryResolver implements ProjectLibraryResolver {
  constructor(
    private readonly registries: ProjectNpmRegistryProvider,
    private readonly compatibility: LibraryCompatibility,
  ) {}

  private async request(
    projectId: string,
    packageName: string,
  ): Promise<{ document: Record<string, unknown>; access: NpmRegistryAccess }> {
    npmPackageNameSchema.parse(packageName)
    const access = await this.registries.forPackage(projectId, packageName)
    const registry = new URL(access.registryUrl)
    if (registry.username || registry.password || registry.search || registry.hash) {
      throw new Error("Registry URL must not contain credentials, query, or fragment")
    }

    const response = await fetch(
      `${registry.href.replace(/\/$/, "")}/${encodeURIComponent(packageName)}`,
      {
        headers: access.token ? { authorization: `Bearer ${access.token}` } : {},
        redirect: "error",
      },
    )

    if (!response.ok) {
      throw new Error(`Registry metadata request failed for "${packageName}" (${response.status})`)
    }

    return { document: (await response.json()) as Record<string, unknown>, access }
  }

  async listVersions(projectId: string, packageName: string): Promise<string[]> {
    const { document } = await this.request(projectId, packageName)
    return Object.keys(z.record(z.string(), z.unknown()).parse(document.versions))
      .filter(version => exactPackageVersionSchema.safeParse(version).success)
      .sort()
  }

  async latestVersion(projectId: string, packageName: string): Promise<string> {
    const { document } = await this.request(projectId, packageName)

    const latest = exactPackageVersionSchema.parse(
      z.record(z.string(), z.string()).parse(document["dist-tags"]).latest,
    )

    if (!Object.hasOwn(z.record(z.string(), z.unknown()).parse(document.versions), latest)) {
      throw new Error("Registry latest version does not exist")
    }

    const versions = z.record(z.string(), z.unknown()).parse(document.versions)

    const sorted = await execa("bun", [
      "-e",
      "const [versions,latest]=JSON.parse(process.argv[1]);console.log(JSON.stringify(versions.filter(v=>!v.includes('-')&&Bun.semver.order(v,latest)<=0).sort((a,b)=>Bun.semver.order(b,a))))",
      JSON.stringify([
        Object.keys(versions).filter(
          version => exactPackageVersionSchema.safeParse(version).success,
        ),
        latest,
      ]),
    ])

    const candidates = [
      latest,
      ...z
        .array(exactPackageVersionSchema)
        .parse(JSON.parse(sorted.stdout))
        .filter(version => version !== latest),
    ]

    for (const version of candidates) {
      const metadata = metadataSchema.parse(versions[version])
      if (metadata.name !== packageName || metadata.version !== version) {
        throw new Error("Registry package identity mismatch")
      }

      try {
        await this.checkCompatibility(metadata)
        return version
      } catch (error) {
        if (!(error instanceof IncompatibleLibraryPackageError)) {
          throw error
        }
      }
    }

    throw new IncompatibleLibraryPackageError(`No compatible release found for "${packageName}"`)
  }

  async getVersion(projectId: string, selection: SelectedLibraryPackage) {
    const { document } = await this.request(projectId, selection.packageName)
    const versions = z.record(z.string(), z.unknown()).parse(document.versions)

    const metadata = metadataSchema.parse(
      versions[exactPackageVersionSchema.parse(selection.version)],
    )

    if (metadata.name !== selection.packageName || metadata.version !== selection.version) {
      throw new Error("Registry package identity mismatch")
    }

    return metadata
  }

  private async checkCompatibility(metadata: z.infer<typeof metadataSchema>): Promise<void> {
    const constraints = [
      { version: this.compatibility.bunVersion, range: metadata.engines?.bun },
      {
        version: this.compatibility.pulumiVersion,
        range: metadata.peerDependencies?.["@pulumi/pulumi"],
      },
    ].filter(item => item.range !== undefined)

    if (!constraints.length) {
      return
    }

    const result = await execa(
      "bun",
      [
        "-e",
        "const constraints=JSON.parse(process.argv[1]);process.exit(constraints.every(({version,range})=>Bun.semver.satisfies(version,range))?0:1)",
        JSON.stringify(constraints),
      ],
      { reject: false },
    )

    if (result.exitCode !== 0) {
      throw new IncompatibleLibraryPackageError(
        `Package "${metadata.name}@${metadata.version}" is incompatible with the snapshot runtime`,
      )
    }
  }

  private async archive(
    projectId: string,
    selection: SelectedLibraryPackage,
    directory: string,
    requireModel: boolean,
  ): Promise<ResolvedLibraryPackage> {
    const metadata = await this.getVersion(projectId, selection)
    await this.checkCompatibility(metadata)
    const access = await this.registries.forPackage(projectId, selection.packageName)
    const url = new URL(metadata.dist.tarball)
    if (url.username || url.password || url.search || url.hash) {
      throw new Error("Tarball URL must not contain credentials, query, or fragment")
    }

    // do not forward scope credentials to arbitrary CDN origins
    const headers: Record<string, string> =
      access.token && url.origin === new URL(access.registryUrl).origin
        ? { authorization: `Bearer ${access.token}` }
        : {}

    const response = await fetch(url, { headers, redirect: "error" })
    if (!response.ok) {
      throw new Error(
        `Package archive request failed for "${selection.packageName}@${selection.version}" (${response.status})`,
      )
    }

    const bytes = new Uint8Array(await response.arrayBuffer())

    try {
      verifyPackageIntegrity(bytes, metadata.dist.integrity)
    } catch (error) {
      throw new Error(
        `Package archive integrity mismatch for "${selection.packageName}@${selection.version}"`,
        { cause: error },
      )
    }

    await mkdir(directory)
    const archive = join(directory, "package.tgz")
    await writeFile(archive, bytes)

    // extract only protocol artifacts, never package-controlled paths or links
    const extract = async (path: string): Promise<Uint8Array> => {
      return await runArchiveCommand(["-xOzf", archive, `package/${path}`])
    }

    const packageJson = z
      .object({ name: z.string(), version: z.string() })
      .parse(JSON.parse(Buffer.from(await extract("package.json")).toString()))

    if (packageJson.name !== selection.packageName || packageJson.version !== selection.version) {
      throw new Error("Package archive identity mismatch")
    }

    let model: LibraryModel = { components: {}, entities: {} }

    if (requireModel) {
      model = libraryModelSchema.parse(decode(await extract("dist/highstate.library.msgpack")))
    }

    for (const collection of ["components", "entities"] as const) {
      for (const [key, value] of Object.entries(model[collection])) {
        if (key !== value.type) {
          throw new Error(`Library artifact key does not match type "${key}"`)
        }
      }
    }

    const sourceManifest = librarySourceManifestSchema.parse(
      JSON.parse(Buffer.from(await extract("dist/highstate.manifest.json")).toString()),
    )

    return {
      ...selection,
      registryUrl: access.registryUrl,
      packageIntegrity: metadata.dist.integrity,
      tarballUrl: url.href,
      model,
      sourceManifest,
      packageMetadata: {
        description: metadata.description,
        homepage: metadata.homepage,
        license: metadata.license,
        engines: metadata.engines,
      },
    }
  }

  async resolve(
    projectId: string,
    input: SelectedLibraryPackage[],
  ): Promise<LibrarySnapshotContent> {
    const selections = selectedLibraryPackagesSchema.parse(input)
    libraryCompatibilitySchema.parse(this.compatibility)
    const bunVersion = (await execa("bun", ["--version"])).stdout.trim()
    if (bunVersion !== this.compatibility.bunVersion) {
      throw new Error(`Snapshot resolution requires Bun "${this.compatibility.bunVersion}"`)
    }

    const directory = await mkdtemp(join(tmpdir(), "highstate-library-"))

    try {
      const packages: ResolvedLibraryPackage[] = []

      for (const selection of selections) {
        packages.push(
          await this.archive(
            projectId,
            selection,
            join(directory, `archive-${packages.length}`),
            true,
          ),
        )
      }

      const merged = mergeLibraryPackages(packages)

      const dependencies = Object.fromEntries(
        selections.map(item => [item.packageName, item.version]),
      )

      // discover implementation packages already pinned by ordinary npm dependencies before adding omitted roots
      await this.install(projectId, directory, dependencies)
      const implementationPackages = new Map<string, ResolvedLibraryPackage>()

      const archivePaths = new Map(
        packages.map((pkg, index) => [
          pkg.packageName,
          join(directory, `archive-${index}`, "package.tgz"),
        ]),
      )

      for (const pkg of packages) {
        for (const component of Object.values(pkg.model.components)) {
          if (component.kind === "unit" && !isUnitModel(component)) {
            throw new Error(`Packaged unit "${component.type}" has no implementation source`)
          }

          if (!isUnitModel(component)) {
            continue
          }

          z.object({ package: npmPackageNameSchema, path: z.string().optional() }).parse(
            component.source,
          )

          const name = npmPackageNameSchema.parse(component.source.package)
          let version = pkg.version

          for (const root of [
            join(directory, "node_modules", pkg.packageName, "node_modules"),
            join(directory, "node_modules"),
          ]) {
            try {
              const installed = JSON.parse(
                await readFile(join(root, name, "package.json"), "utf8"),
              ) as { version: string }

              version = exactPackageVersionSchema.parse(installed.version)
              break
            } catch (error) {
              if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
                throw error
              }
            }
          }

          let implementation =
            packages.find(item => item.packageName === name) ?? implementationPackages.get(name)

          if (implementation && implementation.version !== version) {
            throw new Error(`Implementation "${name}" requires conflicting exact versions`)
          }

          if (!implementation) {
            // otherwise use the definition release's exact version, never an unrelated registry latest
            implementation = await this.archive(
              projectId,
              { packageName: name, version },
              join(directory, `implementation-${implementationPackages.size}`),
              false,
            )

            implementationPackages.set(name, implementation)

            archivePaths.set(
              name,
              join(directory, `implementation-${implementationPackages.size - 1}`, "package.tgz"),
            )

            dependencies[name] = implementation.version
          }

          const path = component.source.path
            ? `./dist/${component.source.path}/index.js`
            : "./dist/index.js"

          if (
            component.source.path
              ?.split(/[\\/]/)
              .some(part => part === ".." || part === "." || part === "") ||
            component.source.path?.includes("\\") ||
            !Object.hasOwn(implementation.sourceManifest.sourceHashes ?? {}, path)
          ) {
            throw new Error(`Missing implementation source manifest for "${component.type}"`)
          }

          await runArchiveCommand(["-tzf", archivePaths.get(name)!, `package/${path.slice(2)}`])
          merged.sourceManifest.packages[name] = implementation.sourceManifest
        }
      }

      const lockfile = await this.install(projectId, directory, dependencies)

      const locked = JSON.parse(lockfile.replace(/,\s*([}\]])/g, "$1")) as {
        packages: Record<string, unknown[]>
      }

      for (const entry of Object.values(locked.packages)) {
        if (
          typeof entry[0] !== "string" ||
          !exactPackageVersionSchema.safeParse(entry[0].slice(entry[0].lastIndexOf("@") + 1))
            .success ||
          !entry.some(value => typeof value === "string" && /^sha(256|384|512)-/.test(value))
        ) {
          throw new Error("Library graph contains a non-registry or unverified dependency")
        }
      }

      for (const pkg of [...packages, ...implementationPackages.values()]) {
        const entry = locked.packages[pkg.packageName]
        if (
          !entry ||
          entry[0] !== `${pkg.packageName}@${pkg.version}` ||
          !entry.includes(pkg.packageIntegrity)
        ) {
          throw new Error(`Frozen graph differs from verified package "${pkg.packageName}"`)
        }
      }

      return {
        selectedPackages: selections,
        packages,
        ...merged,
        lockfile,
        compatibility: this.compatibility,
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  private async install(
    projectId: string,
    directory: string,
    dependencies: Record<string, string>,
    frozenLockfile?: string,
  ): Promise<string> {
    if (Object.keys(dependencies).length === 0) {
      const lockfile =
        frozenLockfile ??
        JSON.stringify({
          lockfileVersion: 1,
          configVersion: 1,
          workspaces: { "": { name: "highstate-snapshot" } },
          packages: {},
        })

      const parsed = JSON.parse(lockfile.replace(/,\s*([}\]])/g, "$1")) as {
        packages: Record<string, unknown>
      }

      if (Object.keys(parsed.packages).length) {
        throw new Error("Empty selection has a nonempty frozen graph")
      }

      await writeFile(join(directory, "bun.lock"), lockfile)

      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ name: "highstate-snapshot", private: true, dependencies }),
      )

      return lockfile
    }

    const lines: string[] = []
    const scopes = (await this.registries.scopes?.(projectId)) ?? {}

    const accesses = new Map<string, NpmRegistryAccess>([
      ["", { registryUrl: "https://registry.npmjs.org/" }],
      ...Object.entries(scopes),
    ])

    for (const name of Object.keys(dependencies).sort()) {
      const access = await this.registries.forPackage(projectId, name)
      accesses.set(name.startsWith("@") ? name.split("/")[0]! : "", access)
    }

    for (const [scopeName, access] of accesses) {
      const registry = new URL(access.registryUrl)
      if (
        registry.username ||
        registry.password ||
        registry.search ||
        registry.hash ||
        /[\r\n]/.test(access.registryUrl)
      ) {
        throw new Error("Invalid registry URL")
      }

      if (scopeName !== "" && !/^@[a-z0-9][a-z0-9._-]*$/.test(scopeName)) {
        throw new Error("Invalid npm registry scope")
      }

      const scope = scopeName ? `${scopeName}:` : ""
      lines.push(`${scope}registry=${registry.href}`)

      if (access.token) {
        if (/[\r\n]/.test(access.token)) {
          throw new Error("Invalid registry token")
        }

        lines.push(
          `//${registry.host}${registry.pathname.replace(/\/?$/, "/")}:_authToken=${access.token}`,
        )
      }
    }

    await writeFile(join(directory, ".npmrc"), [...new Set(lines)].join("\n"), { mode: 0o600 })

    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name: "highstate-snapshot", private: true, dependencies }),
    )

    if (frozenLockfile !== undefined) {
      await writeFile(join(directory, "bun.lock"), frozenLockfile)
    }

    try {
      const result = await execa(
        "bun",
        [
          "install",
          "--ignore-scripts",
          "--no-progress",
          ...(frozenLockfile === undefined ? [] : ["--frozen-lockfile"]),
        ],
        {
          cwd: directory,
          extendEnv: false,
          env: {
            PATH: process.env.PATH,
            HOME: directory,
            TMPDIR: tmpdir(),
            NPM_CONFIG_USERCONFIG: join(directory, ".npmrc"),
            BUN_INSTALL_CACHE_DIR: join(directory, "cache"),
          },
        },
      )

      if (/incorrect peer dependency/i.test(result.stderr)) {
        throw new Error("Library graph has incompatible peer dependencies")
      }

      const lockfile = await readFile(join(directory, "bun.lock"), "utf8")

      const checkUrls = (value: unknown): void => {
        if (typeof value === "string" && /^https?:\/\//.test(value)) {
          const url = new URL(value)
          if (url.username || url.password || url.search || url.hash) {
            throw new Error("Frozen lockfile contains a credential-bearing registry URL")
          }
        } else if (value !== null && typeof value === "object") {
          for (const child of Object.values(value)) {
            checkUrls(child)
          }
        }
      }

      checkUrls(JSON.parse(lockfile.replace(/,\s*([}\]])/g, "$1")))

      if (frozenLockfile !== undefined && lockfile !== frozenLockfile) {
        throw new Error("Frozen library lockfile changed")
      }

      return lockfile
    } finally {
      await rm(join(directory, ".npmrc"), { force: true })
    }
  }

  /**
   * Reconstructs only the stored graph; never re-resolves registry tags or implementation versions.
   */
  async reconstruct(
    projectId: string,
    snapshot: ProjectLibrarySnapshot,
    directory: string,
  ): Promise<void> {
    const { id: _id, hash, ...content } = snapshot

    if (snapshotHash(content) !== hash) {
      throw new Error("Library snapshot hash mismatch")
    }

    const bunVersion = (await execa("bun", ["--version"])).stdout.trim()
    if (bunVersion !== snapshot.compatibility.bunVersion) {
      throw new Error(`Frozen reconstruction requires Bun "${snapshot.compatibility.bunVersion}"`)
    }

    const packageJson = getFrozenSnapshotPackageJson(snapshot)
    await this.install(projectId, directory, packageJson.dependencies, snapshot.lockfile)
  }
}
