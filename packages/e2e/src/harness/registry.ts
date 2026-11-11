import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { networkInterfaces, tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { command } from "./process"

type PackageManifest = {
  name: string
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  [key: string]: unknown
}

export type FixturePackage = {
  name: string
  version: string
  directory: string
  archive: string
  manifest: PackageManifest
  integrity: string
  shasum: string
}

export interface PreparedFixtures {
  directory: string
  packages: FixturePackage[]
  cleanup(): Promise<void>
}

export type PrepareFixturesOptions = {
  workspaceRoot?: string
  /**
   * Parent directory for a unique temporary staging directory.
   */
  directory?: string
}

const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const fixtureSources = fileURLToPath(new URL("../../fixtures/", import.meta.url))

/**
 * Builds real Highstate libraries, manifests, and implementation source hashes.
 * Packages the built workspace dependency closure with publishable dependency ranges.
 * All generated files live in a unique temporary directory removed by cleanup.
 */
export async function prepareFixtures(
  options: PrepareFixturesOptions = {},
): Promise<PreparedFixtures> {
  const root = options.workspaceRoot ?? workspaceRoot
  const directory = await mkdtemp(join(options.directory ?? tmpdir(), "highstate-e2e-registry-"))
  const packages: FixturePackage[] = []
  const cleanup = async () => await rm(directory, { recursive: true, force: true })
  const rootManifest = await Bun.file(join(root, "package.json")).json()
  const workspaces = new Map<string, { path: string; manifest: PackageManifest }>()

  for (const pattern of rootManifest.workspaces as string[]) {
    for await (const path of new Bun.Glob(`${pattern}/package.json`).scan({ cwd: root })) {
      const manifest = (await Bun.file(join(root, path)).json()) as PackageManifest
      workspaces.set(manifest.name, { path: dirname(join(root, path)), manifest })
    }
  }

  const pack = async (path: string, manifest: PackageManifest) => {
    const archive = join(
      directory,
      `${manifest.name.replaceAll("/", "-").replace("@", "")}-${manifest.version}.tgz`,
    )

    await command(
      [
        "tar",
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "-czf",
        archive,
        "package",
      ],
      { cwd: dirname(path) },
    )

    const bytes = await readFile(archive)

    packages.push({
      name: manifest.name,
      version: manifest.version,
      directory: path,
      archive,
      manifest,
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      shasum: createHash("sha1").update(bytes).digest("hex"),
    })
  }

  const build = async (path: string, manifest: PackageManifest) => {
    const modules = join(path, "node_modules")
    await mkdir(modules, { recursive: true })

    try {
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        let target = workspaces.get(dependency)?.path
        if (!target) {
          const owners = [
            root,
            join(root, "node_modules/.bun"),
            ...Array.from(workspaces.values(), workspace => workspace.path),
          ]

          for (const owner of owners) {
            try {
              target = await realpath(join(owner, "node_modules", dependency))
              break
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error
              }
            }
          }
        }

        if (!target) {
          throw new Error(`Installed build dependency "${dependency}" not found`)
        }

        const link = join(modules, dependency)
        await mkdir(dirname(link), { recursive: true })
        await symlink(target, link, "dir")
      }

      if (manifest.name === "@highstate/e2e-resources") {
        // bun --bun places a node shim on PATH; Pulumi serialization requires actual Node.js
        const bunExecutable = await realpath(process.execPath)
        let nodeExecutable: string | undefined

        for (const directory of (process.env.PATH ?? "").split(delimiter)) {
          const candidate = Bun.which("node", { PATH: directory })
          if (candidate && (await realpath(candidate)) !== bunExecutable) {
            nodeExecutable = candidate
            break
          }
        }

        if (!nodeExecutable) {
          throw new Error("Node.js is required to serialize fixture providers")
        }

        const source = join(path, "src/provider.ts")
        const compiled = join(path, "provider-for-serialization.cjs")

        await command([
          process.execPath,
          "build",
          source,
          "--target=node",
          "--packages=external",
          "--format=cjs",
          `--outfile=${compiled}`,
        ])

        const serialized = await command(
          [
            nodeExecutable,
            "-e",
            `const {MarkerProvider} = require(${JSON.stringify(compiled)}); const {runtime} = require('@pulumi/pulumi'); const provider = new MarkerProvider(${JSON.stringify(manifest.version === "2.0.0" ? "v2" : "v1")}); runtime.serializeFunction(() => provider).then(result => process.stdout.write(JSON.stringify(result.text)))`,
          ],
          { cwd: path },
        )

        await writeFile(
          source,
          (await readFile(source, "utf8")).replace('"__SERIALIZED_PROVIDER__"', serialized),
        )

        await rm(compiled)
      }

      await command([process.execPath, join(root, "packages/platform/cli/dist/main.js"), "build"], {
        cwd: path,
      })
    } finally {
      // resolution links belong only to the build, never the registry archives
      await rm(modules, { recursive: true, force: true })
    }
  }

  const packaged = new Set<string>()

  const packageWorkspace = async (name: string): Promise<void> => {
    if (packaged.has(name)) {
      return
    }

    packaged.add(name)
    const workspace = workspaces.get(name)
    if (!workspace) {
      throw new Error(`Workspace package "${name}" not found`)
    }

    const manifest = structuredClone(workspace.manifest)

    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
      for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
        if (range.startsWith("workspace:")) {
          const target = workspaces.get(dependency)
          if (!target) {
            throw new Error(`Workspace dependency "${dependency}" not found`)
          }

          manifest[field]![dependency] = target.manifest.version
          await packageWorkspace(dependency)
        } else if (range.startsWith("catalog:")) {
          manifest[field]![dependency] = rootManifest.catalog[dependency]
        }
      }
    }

    const path = join(directory, "workspace", name.replaceAll("/", "-"), "package")
    await mkdir(path, { recursive: true })
    // copy the published source and build artifacts, never workspace node_modules
    const files = (manifest.files ?? ["dist", "src"]) as string[]

    for (const file of files) {
      const source = join(workspace.path, file)
      if (!(await Bun.file(join(source, "index.js")).exists()) && file === "dist") {
        if (!(await Bun.file(join(source, "highstate.manifest.json")).exists())) {
          throw new Error(`Build workspace package "${name}" before preparing fixtures`)
        }
      }

      await cp(source, join(path, file), { recursive: true })
    }

    delete manifest.devDependencies
    delete manifest.scripts
    delete manifest.nx
    await writeFile(join(path, "package.json"), JSON.stringify(manifest, null, 2))
    await pack(path, manifest)
  }

  try {
    await packageWorkspace("@highstate/contract")
    await packageWorkspace("@highstate/pulumi")

    for (const variant of ["v1", "v2", "conflicting"] as const) {
      const path = join(directory, variant, "package")
      await mkdir(join(path, "src"), { recursive: true })
      const conflict = variant === "conflicting"

      const manifest: PackageManifest = {
        name: conflict ? "@highstate/e2e-conflicting" : "@highstate/e2e-library",
        version: variant === "v2" ? "2.0.0" : "1.0.0",
        type: "module",
        highstate: { type: "library" },
        files: ["dist", "src"],
        exports: {
          ".": { types: "./src/index.ts", default: "./dist/index.js" },
        },
        dependencies: {
          "@highstate/contract": workspaces.get("@highstate/contract")!.manifest.version,
        },
      }

      await writeFile(join(path, "package.json"), JSON.stringify(manifest, null, 2))

      await cp(
        join(fixtureSources, conflict ? "conflicting.ts" : "library.ts"),
        join(path, "src/index.ts"),
      )

      await build(path, manifest)
      await pack(path, manifest)

      if (!conflict) {
        const implementationPath = join(directory, `${variant}-resources`, "package")
        await mkdir(join(implementationPath, "src/marker"), { recursive: true })
        await mkdir(join(implementationPath, "src/services"), { recursive: true })

        const implementationManifest: PackageManifest = {
          name: "@highstate/e2e-resources",
          version: manifest.version,
          type: "module",
          files: ["dist", "src"],
          exports: {
            "./marker": { types: "./src/marker/index.ts", default: "./dist/marker/index.js" },
            "./provider": { types: "./src/provider.ts", default: "./dist/provider.js" },
            "./services": { types: "./src/services/index.ts", default: "./dist/services/index.js" },
          },
          dependencies: {
            "@highstate/contract": workspaces.get("@highstate/contract")!.manifest.version,
            "@highstate/pulumi": workspaces.get("@highstate/pulumi")!.manifest.version,
            "@pulumi/pulumi": "3.232.0",
            // Pulumi's OpenTelemetry 1.x SDK requires an API version below 1.10.
            "@opentelemetry/api": "1.9.1",
          },
        }

        await writeFile(
          join(implementationPath, "package.json"),
          JSON.stringify(implementationManifest, null, 2),
        )

        await cp(join(fixtureSources, "library.ts"), join(implementationPath, "src/library.ts"))
        await cp(join(fixtureSources, "provider.ts"), join(implementationPath, "src/provider.ts"))

        await cp(
          join(fixtureSources, "services/index.ts"),
          join(implementationPath, "src/services/index.ts"),
        )

        const implementation = await readFile(join(fixtureSources, "marker/index.ts"), "utf8")

        await writeFile(
          join(implementationPath, "src/marker/index.ts"),
          implementation.replace("__IMPLEMENTATION_MARKER__", variant),
        )

        await build(implementationPath, implementationManifest)
        await pack(implementationPath, implementationManifest)
      }
    }

    return { directory, packages, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export type RegistryOptions = {
  fixtures?: PreparedFixtures
  hostname?: string
  port?: number
  /**
   * Hostname or host IP reachable from backend and Docker containers.
   */
  publicHost?: string
  /**
   * Public npm metadata fallback; set false to reject unknown packages.
   */
  upstream?: string | false
}

export interface FixtureRegistry {
  url: string
  localUrl: string
  fixtures: PreparedFixtures
  cleanup(): Promise<void>
}

/**
 * Serves integrity-addressed fixture archives and npm metadata on all host interfaces.
 * The advertised URL defaults to a non-loopback host IPv4 address for Docker access.
 * Cleanup stops the server and removes fixtures only when this function prepared them.
 */
export async function startRegistry(options: RegistryOptions = {}): Promise<FixtureRegistry> {
  const fixtures = options.fixtures ?? (await prepareFixtures())
  const upstream = options.upstream === undefined ? "https://registry.npmjs.org" : options.upstream

  const publicHost =
    options.publicHost ??
    Object.values(networkInterfaces())
      .flat()
      .find(address => address?.family === "IPv4" && !address.internal)?.address ??
    "127.0.0.1"

  const byName = new Map<string, FixturePackage[]>()

  for (const pkg of fixtures.packages) {
    const versions = byName.get(pkg.name) ?? []
    versions.push(pkg)
    byName.set(pkg.name, versions)
  }

  const server = Bun.serve({
    hostname: options.hostname ?? "0.0.0.0",
    port: options.port ?? 0,
    async fetch(request): Promise<Response> {
      const path = decodeURIComponent(new URL(request.url).pathname).replace(/^\//, "")
      if (path === "-/ping") {
        return Response.json({ ok: true })
      }

      if (path.startsWith("-/archives/")) {
        const pkg = fixtures.packages.find(
          pkg => path === `-/archives/${pkg.name}/${pkg.version}.tgz`,
        )

        return pkg
          ? new Response(Bun.file(pkg.archive), {
              headers: { "content-type": "application/octet-stream" },
            })
          : new Response("Archive not found", { status: 404 })
      }

      const versions = byName.get(path)
      if (versions) {
        const latest = versions[versions.length - 1]!
        return Response.json({
          name: path,
          "dist-tags": { latest: latest.version },
          versions: Object.fromEntries(
            versions.map(pkg => [
              pkg.version,
              {
                ...pkg.manifest,
                dist: {
                  tarball: `${url}/-/archives/${pkg.name}/${pkg.version}.tgz`,
                  integrity: pkg.integrity,
                  shasum: pkg.shasum,
                },
              },
            ]),
          ),
        })
      }

      // never silently resolve missing fixture/workspace packages from a public release
      if (!upstream || path.startsWith("@highstate/")) {
        return new Response("Package not found", { status: 404 })
      }

      const response = await fetch(`${upstream.replace(/\/$/, "")}/${path}`, {
        headers: { accept: "application/json" },
      })

      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": "application/json" },
      })
    },
  })

  const host = publicHost.includes(":") ? `[${publicHost}]` : publicHost
  const url = `http://${host}:${server.port}`
  return {
    url,
    localUrl: `http://127.0.0.1:${server.port}`,
    fixtures,
    async cleanup() {
      await server.stop(true)

      if (!options.fixtures) {
        await fixtures.cleanup()
      }
    },
  }
}
