import type { ComponentModel, LibraryCompatibility } from "@highstate/contract"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { encode } from "@msgpack/msgpack"
import pino from "pino"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  type ProjectLibraryCatalogProvider,
  ProjectLibraryService,
} from "../business/project-library"
import { projectInputSchema } from "../shared"
import { adminProjectContext, createProjectRequestContext } from "../test-utils/authorization"
import { TestDatabaseManager } from "../test-utils/database"
import { runArchiveCommand } from "./archive-process"
import { NpmProjectLibraryResolver, verifyPackageIntegrity } from "./npm"
import {
  RuntimeProjectLibraryCatalogProvider,
  RuntimeProjectNpmRegistryProvider,
} from "./project-providers"
import { projectLibraryDtoSchema } from "./project-schemas"
import { PrismaProjectLibraryStore } from "./project-store"
import {
  exactPackageVersionSchema,
  type ProjectLibrarySnapshot,
  selectedLibraryPackagesSchema,
} from "./project-types"
import { getFrozenSnapshotPackageJson, snapshotHash } from "./snapshot"

const compatibility: LibraryCompatibility = {
  runtimeProtocolVersion: 1,
  packageFormatVersion: 1,
  bunVersion: process.versions.bun ?? "1.3.13",
  pulumiVersion: "3.232.0",
}
const component = (type: string): ComponentModel => ({
  type,
  kind: "composite",
  args: {},
  inputs: {},
  outputs: {},
  definitionHash: 42,
  meta: { title: type, defaultNamePrefix: "unit" },
})
const empty = () => ({ components: {}, entities: {} })

describe("project library with a local npm registry and real project persistence", () => {
  let directory: string
  let server: Server
  let registry: string
  let database: TestDatabaseManager
  let store: PrismaProjectLibraryStore
  let resolver: NpmProjectLibraryResolver
  const archives = new Map<string, Buffer>()

  const documents = new Map<
    string,
    { name: string; "dist-tags": { latest: string }; versions: Record<string, unknown> }
  >()

  const requests: string[] = []

  async function publish(
    name: string,
    version: string,
    types: string[],
    implementation?: string,
    entityTypes: string[] = [],
    dependencies?: Record<string, string>,
  ): Promise<void> {
    const root = join(directory, `fixture-${archives.size}`)
    await mkdir(join(root, "package", "dist"), { recursive: true })

    await writeFile(
      join(root, "package", "package.json"),
      JSON.stringify({ name, version, dependencies }),
    )

    const components = Object.fromEntries(
      types.map(type => [
        type,
        implementation
          ? { ...component(type), kind: "unit", source: { package: implementation }, secrets: {} }
          : component(type),
      ]),
    )

    await writeFile(
      join(root, "package", "dist", "highstate.library.msgpack"),
      encode({
        components,
        entities: Object.fromEntries(
          entityTypes.map(type => [
            type,
            { type, schema: { type: "string" }, meta: { title: type }, definitionHash: 17 },
          ]),
        ),
      }),
    )

    await writeFile(
      join(root, "package", "dist", "highstate.manifest.json"),
      JSON.stringify({ sourceHashes: { "./dist/index.js": 123 } }),
    )

    await writeFile(join(root, "package", "dist", "index.js"), "export {}")
    const archive = await runArchiveCommand(["-czf", "-", "package"], root)
    const path = `/archives/${archives.size}.tgz`
    archives.set(path, archive)
    const document = documents.get(name) ?? { name, "dist-tags": { latest: version }, versions: {} }

    document.versions[version] = {
      name,
      version,
      dependencies,
      dist: {
        tarball: `${registry}${path}`,
        integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
      },
    }

    document["dist-tags"].latest = version
    documents.set(name, document)
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "highstate-registry-test-"))

    server = createServer((request, response) => {
      const path = request.url ?? ""
      requests.push(path)

      if (request.headers.authorization !== "Bearer fixture-secret") {
        response.writeHead(401).end()
        return
      }

      const archive = archives.get(path)
      if (archive) {
        response.writeHead(200, { "content-type": "application/octet-stream" }).end(archive)
        return
      }

      const document = documents.get(decodeURIComponent(path.slice(1)))
      if (!document) {
        response.writeHead(404).end()
        return
      }

      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(document))
    })

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") {
      throw new Error("Registry did not start")
    }

    registry = `http://127.0.0.1:${address.port}`
    await publish("@fixture/a", "1.0.0", ["test.a.v1"])
    await publish("@fixture/a", "2.0.0", ["test.shared.v1"])
    await publish("@fixture/b", "1.0.0", ["test.b.v1"])
    await publish("@fixture/b", "2.0.0", ["test.shared.v1"])
    await publish("@fixture/definitions", "1.0.0", ["test.unit.v1"], "@fixture/implementation")
    await publish("@fixture/implementation", "1.0.0", [])
    database = await TestDatabaseManager.create(pino({ level: "silent" }))
    store = new PrismaProjectLibraryStore(database)

    resolver = new NpmProjectLibraryResolver(
      { forPackage: async () => ({ registryUrl: registry, token: "fixture-secret" }) },
      compatibility,
    )
  }, 30000)

  afterAll(async () => {
    await database?.cleanup()

    await new Promise<void>((resolve, reject) =>
      server?.close(error => (error ? reject(error) : resolve())),
    )

    await rm(directory, { recursive: true, force: true })
  })

  function service(projectId: string, initial = [{ packageName: "@fixture/a", version: "1.0.0" }]) {
    const images = {
      ensureDesiredImage: vi.fn(async (_projectId: string, snapshot: ProjectLibrarySnapshot) => {
        expect((await store.read(projectId)).desiredSnapshotId).toBe(snapshot.id)
        return { status: "queued" }
      }),
    }

    const catalogs: ProjectLibraryCatalogProvider = {
      virtualModel: async () => empty(),
      localOverlay: async () => empty(),
      supportsLocalOverlay: async () => true,
    }

    const library = new ProjectLibraryService(store, resolver, images, catalogs, initial)
    return { library, images, catalogs, context: adminProjectContext(projectId) }
  }

  it("rejects ranges, aliases, invalid identities and duplicate selections", () => {
    for (const version of [
      "latest",
      "^1.0.0",
      "01.0.0",
      "1.0",
      "v1.0.0",
      "1.0.0-01",
      "file:foo",
      "9999999999999999999999.0.0",
    ]) {
      expect(exactPackageVersionSchema.safeParse(version).success).toBe(false)
    }

    expect(exactPackageVersionSchema.parse("1.2.3-rc.1+build.2")).toBe("1.2.3-rc.1+build.2")

    expect(() =>
      selectedLibraryPackagesSchema.parse([
        { packageName: "@fixture/a", version: "1.0.0" },
        { packageName: "@fixture/a", version: "2.0.0" },
      ]),
    ).toThrow()

    expect(() =>
      selectedLibraryPackagesSchema.parse([{ packageName: "../a", version: "1.0.0" }]),
    ).toThrow()
  })

  it("verifies archive integrity with strongest supported SRI", () => {
    const bytes = Buffer.from("archive")
    const sha256 = createHash("sha256").update(bytes).digest("base64")
    expect(() => verifyPackageIntegrity(bytes, `sha256-${sha256}`)).not.toThrow()

    expect(() => verifyPackageIntegrity(Buffer.from("changed"), `sha256-${sha256}`)).toThrow(
      "integrity mismatch",
    )

    expect(() =>
      verifyPackageIntegrity(
        bytes,
        `sha256-${sha256} sha512-${Buffer.alloc(64).toString("base64")}`,
      ),
    ).toThrow("integrity mismatch")

    expect(() => verifyPackageIntegrity(bytes, "sha1-deadbeef")).toThrow("supported integrity")
  })

  it("resolves omitted implementation packages, persists portable artifacts, and reconstructs frozen", async () => {
    const { library, context } = service("implementations", [
      { packageName: "@fixture/definitions", version: "1.0.0" },
    ])

    const dto = await library.bootstrap(context.projectId)
    expect(dto.diagnostics).toEqual([])

    expect(
      projectLibraryDtoSchema.parse(dto).desiredSnapshot?.model.components["test.unit.v1"],
    ).toMatchObject({ source: { package: "@fixture/implementation" }, definitionHash: 42 })

    const snapshot = await library.desiredSnapshot(context.projectId)
    expect(snapshot.lockfile).toContain("@fixture/implementation@1.0.0")

    expect(getFrozenSnapshotPackageJson(snapshot).dependencies["@fixture/implementation"]).toBe(
      "1.0.0",
    )

    expect(
      snapshot.sourceManifest.packages["@fixture/implementation"]?.sourceHashes?.[
        "./dist/index.js"
      ],
    ).toBe(123)

    expect(snapshot.lockfile).not.toContain("fixture-secret")
    expect(snapshot.lockfile).not.toContain(directory)
    expect(snapshot.model.components["test.unit.v1"]?.definitionHash).toBe(42)

    expect(
      (await library.getSnapshotUnitSources(context.projectId, snapshot.id, ["test.unit.v1"]))[0],
    ).toMatchObject({
      snapshotId: snapshot.id,
      packageName: "@fixture/definitions",
      implementationPackage: "@fixture/implementation",
      sourceHash: 123,
      relativePath: "node_modules/@fixture/implementation/dist",
    })

    const reconstruction = join(directory, "reconstruction")
    await mkdir(reconstruction)
    await resolver.reconstruct(context.projectId, snapshot, reconstruction)
    expect(await readFile(join(reconstruction, "bun.lock"), "utf8")).toBe(snapshot.lockfile)
    await expect(readFile(join(reconstruction, ".npmrc"), "utf8")).rejects.toThrow()

    await expect(
      resolver.reconstruct(context.projectId, { ...snapshot, hash: "bad" }, reconstruction),
    ).rejects.toThrow("hash mismatch")
  }, 30000)

  it("rejects full-set conflicts atomically and leaves historical catalogs immutable", async () => {
    const { library, context, images } = service("atomic")
    await library.bootstrap(context.projectId)
    await library.addPackage(context, { packageName: "@fixture/b", version: "1.0.0" })
    const previous = await store.read(context.projectId)
    const snapshot = await library.desiredSnapshot(context.projectId)
    await expect(library.updateAll(context)).rejects.toThrow("Duplicate")
    expect(await store.read(context.projectId)).toEqual(previous)
    expect(images.ensureDesiredImage).toHaveBeenCalledTimes(2)
    await library.updatePackage(context, { packageName: "@fixture/a", version: "2.0.0" })

    expect(
      (await library.historicalCatalog(context.projectId, snapshot.id)).model.components[
        "test.a.v1"
      ],
    ).toBeDefined()

    expect((await library.catalog(context.projectId)).model.components["test.a.v1"]).toBeUndefined()
  }, 30000)

  it("fences concurrent proposals and reuses immutable package versions after removal/readdition", async () => {
    const { library, context } = service("cas")
    await library.bootstrap(context.projectId)
    const previous = await store.read(context.projectId)

    const content = await resolver.resolve(context.projectId, [
      { packageName: "@fixture/b", version: "1.0.0" },
    ])

    await library.updatePackage(context, { packageName: "@fixture/a", version: "2.0.0" })

    await expect(
      store.commit(context.projectId, previous, content, snapshotHash(content)),
    ).rejects.toThrow("concurrently")

    const before = await database.forProject(context.projectId)
    const count = await before.libraryPackageVersion.count()
    await library.removePackage(context, { packageName: "@fixture/a" })
    await library.addPackage(context, { packageName: "@fixture/a", version: "1.0.0" })
    expect(await before.libraryPackageVersion.count()).toBe(count)
  }, 30000)

  it("hashes canonical content independently of order, row IDs, timestamps and host paths", async () => {
    const content = await resolver.resolve("hash", [
      { packageName: "@fixture/b", version: "1.0.0" },
      { packageName: "@fixture/a", version: "1.0.0" },
    ])

    const enriched = {
      ...content,
      id: "generated",
      createdAt: new Date(),
      projectPath: "/host/path",
      selectedPackages: content.selectedPackages.toReversed(),
      packages: content.packages
        .toReversed()
        .map(pkg => ({ ...pkg, id: "other", createdAt: new Date() })),
    }

    expect(snapshotHash(enriched)).toBe(snapshotHash(content))

    expect(
      snapshotHash({
        ...content,
        compatibility: { ...content.compatibility, runtimeProtocolVersion: 2 },
      }),
    ).not.toBe(snapshotHash(content))
  }, 30000)

  it("disables the complete conflicting overlay and enforces runtime restrictions", async () => {
    const { library, context, catalogs } = service("overlay")
    await library.bootstrap(context.projectId)

    catalogs.localOverlay = async () => ({
      components: {
        "test.a.v1": component("test.a.v1"),
        "test.local.v1": component("test.local.v1"),
      },
      entities: {},
    })

    const conflict = await library.catalog(context.projectId)
    expect(conflict.overlay.active).toBe(false)
    expect(conflict.overlay.conflicts).toEqual(["components:test.a.v1"])
    expect(conflict.model.components["test.local.v1"]).toBeUndefined()

    catalogs.localOverlay = async () => ({
      components: { "test.local.v1": component("test.local.v1") },
      entities: {},
    })

    expect((await library.catalog(context.projectId)).sources["components:test.local.v1"]).toEqual({
      kind: "local",
    })

    catalogs.supportsLocalOverlay = async () => false
    expect((await library.catalog(context.projectId)).overlay.reason).toContain("well-known")
    await expect(library.setLocalOverlay(context, { enabled: true })).rejects.toThrow("well-known")
    catalogs.supportsLocalOverlay = async () => true

    catalogs.localOverlay = async () => {
      throw new Error("Separate overlay reads must not be used")
    }

    catalogs.localOverlaySnapshot = async () => ({
      model: {
        components: { "test.atomic-local.v1": component("test.atomic-local.v1") },
        entities: {},
      },
      revision: "captured-source-and-definition-revision",
    })

    const atomic = await library.catalog(context.projectId)
    expect(atomic.overlay.active).toBe(true)
    expect(atomic.overlay.revision).toBe("captured-source-and-definition-revision")
    expect(atomic.sources["components:test.atomic-local.v1"]).toEqual({ kind: "local" })
  }, 30000)

  it("keeps failed bootstrap accessible, resumes on unlock, and authorizes before network access", async () => {
    const { library, context } = service("bootstrap", [
      { packageName: "@fixture/missing", version: "1.0.0" },
    ])

    const result = await library.bootstrap(context.projectId)
    expect(result.desiredSnapshot).toBeNull()
    expect(result.diagnostics[0]?.phase).toBe("resolution")
    const count = requests.length

    await expect(
      library.listPackageVersions(createProjectRequestContext(context.projectId), {
        packageName: "@fixture/a",
      }),
    ).rejects.toThrow()

    expect(requests.length).toBe(count)
    await publish("@fixture/missing", "1.0.0", ["test.recovered.v1"])
    expect((await library.onProjectUnlocked(context.projectId)).desiredSnapshot).not.toBeNull()
    expect((await library.getProjectLibrary(context)).diagnostics).toEqual([])
  }, 30000)

  it("rejects tampered tarballs and mismatched metadata before changing selections", async () => {
    await publish("@fixture/tampered", "1.0.0", ["test.tampered.v1"])
    const document = documents.get("@fixture/tampered")!
    const metadata = document.versions["1.0.0"] as { name: string; dist: { tarball: string } }
    const path = new URL(metadata.dist.tarball).pathname
    const original = archives.get(path)!
    archives.set(path, Buffer.from("modified archive"))
    const { library, context } = service("integrity")
    await library.bootstrap(context.projectId)
    const before = await store.read(context.projectId)

    await expect(
      library.addPackage(context, { packageName: "@fixture/tampered", version: "1.0.0" }),
    ).rejects.toThrow("integrity mismatch")

    expect(await store.read(context.projectId)).toEqual(before)
    archives.set(path, original)
    metadata.name = "@fixture/wrong"

    await expect(
      library.addPackage(context, { packageName: "@fixture/tampered", version: "1.0.0" }),
    ).rejects.toThrow("identity mismatch")

    expect(await store.read(context.projectId)).toEqual(before)
  }, 30000)

  it("selects eligible exact releases and exposes real registry version details", async () => {
    await publish("@fixture/compatible", "1.0.0", ["test.compatible.v1"])
    await publish("@fixture/compatible", "2.0.0", ["test.compatible.v1"])

    const metadata = documents.get("@fixture/compatible")!.versions["2.0.0"] as Record<
      string,
      unknown
    >

    metadata.engines = { bun: ">=99.0.0" }
    expect(await resolver.latestVersion("versions", "@fixture/compatible")).toBe("1.0.0")

    const { library, context } = service("versions", [
      { packageName: "@fixture/compatible", version: "1.0.0" },
    ])

    await library.bootstrap(context.projectId)

    expect(
      await library.listPackageVersions(context, { packageName: "@fixture/compatible" }),
    ).toEqual(["1.0.0", "2.0.0"])

    expect(
      await library.getPackageVersion(context, {
        packageName: "@fixture/compatible",
        version: "1.0.0",
      }),
    ).toMatchObject({ name: "@fixture/compatible", version: "1.0.0" })

    await expect(
      library.updatePackage(context, { packageName: "@fixture/compatible", version: "2.0.0" }),
    ).rejects.toThrow("incompatible")

    expect(
      (await library.updatePackage(context, { packageName: "@fixture/compatible" }))
        .selectedPackages[0]?.version,
    ).toBe("1.0.0")
  }, 30000)

  it("keeps a committed desired snapshot on image failure and retries that exact snapshot", async () => {
    const { library, context, images } = service("image-failure")
    images.ensureDesiredImage.mockRejectedValueOnce(new Error("Builder unavailable"))
    const dto = await library.bootstrap(context.projectId)
    expect(dto.desiredSnapshot).not.toBeNull()
    expect(dto.diagnostics[0]?.phase).toBe("image")
    await library.retryDesiredImage(context)
    expect(images.ensureDesiredImage.mock.calls[1]?.[1].id).toBe(dto.desiredSnapshot?.id)
    expect((await library.getProjectLibrary(context)).diagnostics).toEqual([])
  }, 30000)

  it("resumes a failed post-commit publication without rolling back selections or skipping the image", async () => {
    const { context, images, catalogs } = service("publication")
    const publish = vi.fn(async () => {})
    publish.mockRejectedValueOnce(new Error("Event transport unavailable"))

    const library = new ProjectLibraryService(
      store,
      resolver,
      images,
      catalogs,
      [{ packageName: "@fixture/a", version: "1.0.0" }],
      publish,
    )

    const dto = await library.bootstrap(context.projectId)
    expect(dto.desiredSnapshot).not.toBeNull()
    expect(dto.diagnostics[0]?.phase).toBe("publication")
    expect(images.ensureDesiredImage).toHaveBeenCalledTimes(1)
    expect((await library.onProjectUnlocked(context.projectId)).diagnostics).toEqual([])
    expect(publish).toHaveBeenCalledTimes(2)
  }, 30000)

  it("allows only one of overlapping proposals to replace a captured selection", async () => {
    const { library, context } = service("overlap")
    await library.bootstrap(context.projectId)

    const result = await Promise.allSettled([
      library.updatePackage(context, { packageName: "@fixture/a", version: "2.0.0" }),
      library.addPackage(context, { packageName: "@fixture/b", version: "1.0.0" }),
    ])

    expect(result.filter(item => item.status === "fulfilled")).toHaveLength(1)
    const snapshot = await library.desiredSnapshot(context.projectId)

    expect((await store.read(context.projectId)).selectedPackages).toEqual(
      snapshot.selectedPackages,
    )
  }, 30000)

  it("uses only selected-runtime scope credentials and requires well-known identity for overlays", async () => {
    const input = projectInputSchema.parse({ name: "providers", meta: { title: "Providers" } })

    const project = await database.backend.project.create({
      data: {
        ...input,
        databaseVersion: 0,
        encryptedMasterKey: "",
        unlockSuite: { encryptedIdentities: [], hasPasskey: false, passkeys: [] },
      },
    })

    const selected = await database.backend.npmRegistryCredential.create({
      data: {
        meta: { title: "Selected" },
        scope: "@fixture/",
        registryUrl: registry,
        encryptedCredentials: "selected-encrypted",
        runtimes: { connect: { id: project.containerRuntimeId } },
      },
    })

    await database.backend.npmRegistryCredential.create({
      data: {
        meta: { title: "Unavailable" },
        scope: "@other/",
        registryUrl: registry,
        encryptedCredentials: "other-encrypted",
      },
    })

    const decrypt = vi.fn(async () => ({ token: "selected-token" }))
    const npm = new RuntimeProjectNpmRegistryProvider(database, { decrypt })

    expect(await npm.forPackage(project.id, "@fixture/a")).toEqual({
      registryUrl: registry,
      token: "selected-token",
    })

    expect(decrypt.mock.calls).toEqual([[selected.id, "selected-encrypted"]])

    expect(await npm.forPackage(project.id, "@other/a")).toEqual({
      registryUrl: "https://registry.npmjs.org/",
    })

    const loadLocalOverlay = vi.fn(async () => empty())

    const catalog = new RuntimeProjectLibraryCatalogProvider(
      database,
      { loadLocalOverlay },
      { getVirtualComponentsCore: async () => ({}), getVirtualEntities: () => ({}) },
    )

    expect(await catalog.supportsLocalOverlay(project.id)).toBe(true)

    const runtime = await database.backend.containerRuntime.create({
      data: {
        meta: { title: "Another local engine" },
        spec: {
          type: "docker",
          local: true,
          engineEndpoint: "unix:///var/run/docker.sock",
          runtimeApiUrl: "https://backend.test",
        },
      },
    })

    await database.backend.project.update({
      where: { id: project.id },
      data: { containerRuntimeId: runtime.id },
    })

    expect(await catalog.supportsLocalOverlay(project.id)).toBe(false)
    await expect(catalog.localOverlay(project.id)).rejects.toThrow("well-known")
    expect(loadLocalOverlay).not.toHaveBeenCalled()

    expect(await npm.forPackage(project.id, "@fixture/a")).toEqual({
      registryUrl: "https://registry.npmjs.org/",
    })
  })

  it("rejects entity conflicts and disables a whole overlay for entity-only collisions", async () => {
    await publish("@fixture/entity-a", "1.0.0", [], undefined, ["test.entity.v1"])
    await publish("@fixture/entity-b", "1.0.0", [], undefined, ["test.entity.v1"])

    const { library, context, catalogs } = service("entities", [
      { packageName: "@fixture/entity-a", version: "1.0.0" },
    ])

    await library.bootstrap(context.projectId)
    const previous = await store.read(context.projectId)

    await expect(
      library.addPackage(context, { packageName: "@fixture/entity-b", version: "1.0.0" }),
    ).rejects.toThrow("Duplicate entities")

    expect(await store.read(context.projectId)).toEqual(previous)
    const packaged = await library.desiredSnapshot(context.projectId)

    catalogs.localOverlay = async () => ({
      components: { "test.local.v1": component("test.local.v1") },
      entities: packaged.model.entities,
    })

    const catalog = await library.catalog(context.projectId)
    expect(catalog.overlay.conflicts).toEqual(["entities:test.entity.v1"])
    expect(catalog.model.components["test.local.v1"]).toBeUndefined()
    expect(catalog.model.entities["test.entity.v1"]?.definitionHash).toBe(17)
  }, 30000)

  it("rejects incompatible omitted implementation versions as one proposal", async () => {
    await publish("@fixture/defs-one", "1.0.0", ["test.impl-one.v1"], "@fixture/implementation")
    await publish("@fixture/defs-two", "2.0.0", ["test.impl-two.v1"], "@fixture/implementation")

    const { library, context } = service("implementation-conflict", [
      { packageName: "@fixture/defs-one", version: "1.0.0" },
    ])

    await library.bootstrap(context.projectId)
    const previous = await store.read(context.projectId)

    await expect(
      library.addPackage(context, { packageName: "@fixture/defs-two", version: "2.0.0" }),
    ).rejects.toThrow("conflicting exact versions")

    expect(await store.read(context.projectId)).toEqual(previous)
  }, 30000)

  it("does not reuse a snapshot when the same package artifact resolves a different dependency environment", async () => {
    await publish("@fixture/leaf", "1.0.0", [])

    await publish("@fixture/environment", "1.0.0", ["test.environment.v1"], undefined, [], {
      "@fixture/leaf": "^1.0.0",
    })

    const { library, context } = service("dependency-environment", [
      { packageName: "@fixture/environment", version: "1.0.0" },
    ])

    await library.bootstrap(context.projectId)
    const previous = await library.desiredSnapshot(context.projectId)
    await publish("@fixture/leaf", "1.1.0", [])

    const next = await library.updatePackage(context, {
      packageName: "@fixture/environment",
      version: "1.0.0",
    })

    expect(next.hash).not.toBe(previous.hash)
    expect(next.packages[0]?.id).toBe(previous.packages[0]?.id)
    expect(next.lockfile).toContain("@fixture/leaf@1.1.0")

    expect((await library.historicalSnapshot(context.projectId, previous.id)).lockfile).toContain(
      "@fixture/leaf@1.0.0",
    )

    const root = join(directory, "historical-environment")
    await mkdir(root)
    await resolver.reconstruct(context.projectId, previous, root)

    expect(
      JSON.parse(
        await readFile(join(root, "node_modules", "@fixture/leaf", "package.json"), "utf8"),
      ).version,
    ).toBe("1.0.0")
  }, 30000)
})
