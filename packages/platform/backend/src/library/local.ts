import type { Logger } from "pino"
import type { LibraryBackend, ProjectEvaluationResult, ResolvedUnitSource } from "./abstractions"
import type {
  PackageResolutionResponse,
  PackageResolutionWorkerData,
} from "./package-resolution-worker"
import type { WorkerData } from "./worker/protocol"
import { EventEmitter, on } from "node:events"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { type InstanceModel, isUnitModel } from "@highstate/contract"
import { decode } from "@msgpack/msgpack"
import { BetterLock } from "better-lock"
import { glob } from "glob"
import { resolve as importMetaResolve } from "import-meta-resolve"
import { addDependency, runScript } from "nypm"
import PQueue from "p-queue"
import { type PackageJson, readPackageJSON, resolvePackageJSON } from "pkg-types"
import { groupBy } from "remeda"
import Watcher from "watcher"
import { z } from "zod"
import { resolveMainLocalProject, stringArrayType } from "../common"
import {
  diffLibraries,
  type LibraryModel,
  type LibraryUpdate,
  type ResolvedInstanceInput,
} from "../shared"

export const localLibraryBackendConfig = z.object({
  HIGHSTATE_LIBRARY_BACKEND_LOCAL_LIBRARY_PACKAGES: stringArrayType.default(() => [
    "@highstate/library",
  ]),
  HIGHSTATE_LIBRARY_BACKEND_LOCAL_WORKSPACE_PATH: z.string().optional(),
  HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_CONCURRENCY: z.coerce.number().int().positive().default(3),
  HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_STARTUP: z.stringbool().default(true),
  HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_CHANGES: z.stringbool().default(true),
})

interface Events {
  library: [LibraryUpdate[]]
  resolvedUnitSource: [ResolvedUnitSource]
}

type HighstateManifestJson = {
  sourceHashes?: Record<string, number>
}

type LibraryPackage = {
  name: string
  rootPath: string
  isHighstateManaged: boolean
}

type RebuildState = {
  inProgress: boolean
  pending: boolean
}

export class LocalLibraryBackend implements LibraryBackend {
  private readonly watcher: Watcher
  private readonly workspacePath: string
  private readonly workspacePatterns: string[]

  private readonly lock = new BetterLock()
  private readonly eventEmitter = new EventEmitter<Events>()

  private library: LibraryModel | null = null

  private readonly packages = new Map<string, LibraryPackage>()
  private readonly resolvedUnitSources = new Map<string, ResolvedUnitSource>()
  private readonly rebuildStates = new Map<string, RebuildState>()
  private readonly ignoredPackages = new Set<string>()
  private readonly buildQueue: PQueue
  private readonly configBuildOnStartup: boolean
  private readonly configBuildOnChanges: boolean

  private constructor(
    private readonly libraryPackages: string[],
    workspacePath: string,
    workspacePatterns: string[],
    buildConcurrency: number,
    buildOnStartup: boolean,
    buildOnChanges: boolean,
    private readonly logger: Logger,
  ) {
    this.workspacePath = workspacePath
    this.workspacePatterns = workspacePatterns
    this.buildQueue = new PQueue({ concurrency: buildConcurrency })
    this.configBuildOnStartup = buildOnStartup
    this.configBuildOnChanges = buildOnChanges
    this.watcher = new Watcher([workspacePath], {
      recursive: true,
      ignoreInitial: true,
      ignore: /\.git|node_modules|dist|\.highstate|\.nx/,
    })

    this.watcher.on("all", (event: string, path: string) => {
      this.logger.debug({ event, path }, "library event")

      if (!path.endsWith(".json") && !path.endsWith(".ts")) {
        return
      }

      void this.handleFileEvent(path)
    })
  }

  async loadLibrary(): Promise<LibraryModel> {
    return await this.lock.acquire(async () => await this.getLibrary())
  }

  async *watchLibrary(_libraryId: string, signal?: AbortSignal): AsyncIterable<LibraryUpdate[]> {
    for await (const [library] of on(this.eventEmitter, "library", { signal })) {
      yield library
    }
  }

  getLoadedResolvedUnitSources(): Promise<ResolvedUnitSource[]> {
    return this.lock.acquire(() => {
      return Array.from(this.resolvedUnitSources.values())
    })
  }

  async getResolvedUnitSources(
    _libraryId: string,
    unitTypes: string[],
  ): Promise<ResolvedUnitSource[]> {
    return await this.lock.acquire(async () => {
      const library = await this.getLibrary()

      const units = unitTypes
        .map(type => library.components[type])
        .filter(Boolean)
        .filter(isUnitModel)

      const packageNames = Object.keys(groupBy(units, unit => unit.source.package))

      await this.ensureLibraryPackagesLoaded(packageNames, true)

      const result: ResolvedUnitSource[] = []

      for (const unitType of unitTypes) {
        const resolvedUnitSource = this.resolvedUnitSources.get(unitType)

        if (resolvedUnitSource) {
          result.push(resolvedUnitSource)
        } else {
          this.logger.warn(`resolved unit source not found for unit: "%s"`, unitType)
        }
      }

      return result
    })
  }

  async *watchResolvedUnitSources(
    _libraryId: string,
    signal?: AbortSignal,
  ): AsyncIterable<ResolvedUnitSource> {
    for await (const [resolvedUnitSource] of on(this.eventEmitter, "resolvedUnitSource", {
      signal,
    })) {
      yield resolvedUnitSource
    }
  }

  async evaluateCompositeInstances(
    _libraryId: string,
    allInstances: InstanceModel[],
    resolvedInputs: Record<string, Record<string, ResolvedInstanceInput[]>>,
  ): Promise<ProjectEvaluationResult> {
    const worker = this.createLibraryWorker({
      libraryModulePaths: this.libraryPackages,
      allInstances,
      resolvedInputs,
    })

    for await (const [event] of on(worker, "message", { signal: AbortSignal.timeout(10_000) })) {
      return event as ProjectEvaluationResult
    }

    throw new Error("Worker ended without sending any response")
  }

  private async getLibrary(): Promise<LibraryModel> {
    if (this.library) {
      return this.library
    }

    return await this.reloadLibrary()
  }

  private async reloadLibrary(): Promise<LibraryModel> {
    this.logger.info("reloading library")

    this.eventEmitter.emit("library", [{ type: "reload-started" }])

    await this.ensureLibraryPackagesLoaded(this.libraryPackages, true)

    const loadedPackages = this.packages
      .values()
      .filter(pkg => this.libraryPackages.includes(pkg.name))

    const mergedLibrary: LibraryModel = { components: {}, entities: {} }

    for (const loadedPackage of loadedPackages) {
      const libraryContent = await this.readLibraryContent(loadedPackage)

      for (const [componentType, component] of Object.entries(libraryContent.components)) {
        mergedLibrary.components[componentType] = component
      }

      for (const [entityType, entity] of Object.entries(libraryContent.entities)) {
        mergedLibrary.entities[entityType] = entity
      }
    }

    const updates = diffLibraries(this.library ?? { components: {}, entities: {} }, mergedLibrary)

    this.eventEmitter.emit("library", updates)
    this.library = mergedLibrary

    this.logger.info("library reloaded")

    this.eventEmitter.emit("library", [{ type: "reload-completed" }])

    return this.library
  }

  private async reloadUnitManifest(libraryPackage: LibraryPackage): Promise<void> {
    const library = this.library
    if (!library) {
      this.logger.warn(
        `library not loaded, cannot reload unit manifest for package: "%s"`,
        libraryPackage.name,
      )
      return
    }

    const manifest = await this.readLibraryPackageManifest(libraryPackage)
    const packageJson = await readPackageJSON(libraryPackage.rootPath)

    for (const unit of Object.values(library.components)) {
      if (!isUnitModel(unit)) {
        continue
      }

      if (unit.source.package !== libraryPackage.name) {
        continue
      }

      // TODO: resolve the path
      const relativePath = unit.source.path ? `./dist/${unit.source.path}` : `./dist`
      const sourceHash = manifest?.sourceHashes?.[`${relativePath}/index.js`]

      if (!sourceHash) {
        this.logger.warn(`source hash not found for unit: "%s"`, unit.type)
        continue
      }

      const resolvedSource = this.resolvedUnitSources.get(unit.type)

      const newResolvedSource: ResolvedUnitSource = {
        unitType: unit.type,
        sourceHash,
        projectPath: resolve(libraryPackage.rootPath, relativePath),
        allowedDependencies: Object.keys(packageJson.peerDependencies ?? {}),
      }

      if (
        resolvedSource?.sourceHash === newResolvedSource.sourceHash &&
        resolvedSource?.projectPath === newResolvedSource.projectPath
      ) {
        continue
      }

      this.resolvedUnitSources.set(unit.type, newResolvedSource)
      this.eventEmitter.emit("resolvedUnitSource", newResolvedSource)
      this.logger.trace(`updated source for unit: "%s"`, unit.type)
    }
  }

  private async ensureLibraryPackagesLoaded(
    names: string[],
    installIfNotFound = false,
  ): Promise<void> {
    const packagesToLoad = names.filter(name => !this.packages.has(name))

    if (packagesToLoad.length > 0) {
      await this.loadLibraryPackages(packagesToLoad, installIfNotFound)
    }
  }

  private logIgnoredPackage(identifier: string, message: string): void {
    if (this.ignoredPackages.has(identifier)) {
      return
    }

    this.logger.debug({ package: identifier }, message)
    this.ignoredPackages.add(identifier)
  }

  private isHighstateManagedPackage(packageName: string, packageJson: PackageJson): boolean {
    if (!packageJson.devDependencies?.["@highstate/cli"]) {
      this.logIgnoredPackage(packageName, "skipping package without @highstate/cli dev dependency")

      return false
    }

    const buildScript = packageJson.scripts?.build ?? ""

    if (!buildScript.includes("highstate build")) {
      this.logIgnoredPackage(
        packageName,
        'skipping package without "highstate build" in build script',
      )

      return false
    }

    this.ignoredPackages.delete(packageName)

    return true
  }

  private async registerLibraryPackage(
    packageRootPath: string,
    declaredName?: string,
    existingPackageJson?: PackageJson,
  ): Promise<LibraryPackage | null> {
    let packageJson = existingPackageJson

    if (!packageJson) {
      try {
        packageJson = await readPackageJSON(packageRootPath)
      } catch (error) {
        this.logger.debug({ error }, `failed to read package.json at path: "%s"`, packageRootPath)
        this.logIgnoredPackage(packageRootPath, "skipping package without readable package.json")
        return null
      }
    }

    if (!packageJson.name) {
      this.logIgnoredPackage(packageRootPath, "skipping package without name in package.json")

      return null
    }

    if (declaredName && declaredName !== packageJson.name) {
      this.logger.warn(
        {
          declaredName,
          packageJsonName: packageJson.name,
          packageRootPath,
        },
        "resolved package name does not match declared name",
      )
    }

    const isHighstateManaged = this.isHighstateManagedPackage(packageJson.name, packageJson)

    let libraryPackage = this.packages.get(packageJson.name)

    if (libraryPackage) {
      libraryPackage.rootPath = packageRootPath
      libraryPackage.isHighstateManaged = isHighstateManaged
    } else {
      libraryPackage = {
        name: packageJson.name,
        rootPath: packageRootPath,
        isHighstateManaged,
      }

      this.packages.set(packageJson.name, libraryPackage)
    }

    this.ignoredPackages.delete(packageRootPath)

    if (
      libraryPackage.isHighstateManaged &&
      this.library &&
      !this.libraryPackages.includes(libraryPackage.name) &&
      libraryPackage.name !== "@highstate/contract"
    ) {
      await this.reloadUnitManifest(libraryPackage)
    }

    return libraryPackage
  }

  private async rebuildLibraryPackage(libraryPackage: LibraryPackage): Promise<void> {
    if (!libraryPackage.isHighstateManaged) {
      this.logIgnoredPackage(
        libraryPackage.name,
        "skipping rebuild for non Highstate-managed package",
      )

      return
    }

    const now = Date.now()

    this.logger.info(`rebuilding "%s"`, libraryPackage.name)
    await runScript("build", { cwd: libraryPackage.rootPath })

    const duration = Date.now() - now
    this.logger.info(`built "%s" in %dms`, libraryPackage.name, duration)

    if (this.library && !this.libraryPackages.includes(libraryPackage.name)) {
      await this.reloadUnitManifest(libraryPackage)
    }
  }

  private async readLibraryPackageManifest(
    libraryPackage: LibraryPackage,
  ): Promise<HighstateManifestJson | undefined> {
    const manifestPath = resolve(libraryPackage.rootPath, "dist", "highstate.manifest.json")

    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as HighstateManifestJson

      return manifest
    } catch (error) {
      this.logger.debug(
        { error },
        `failed to read highstate manifest of package: "%s"`,
        libraryPackage.name,
      )

      return undefined
    }
  }

  private async readLibraryContent(libraryPackage: LibraryPackage): Promise<LibraryModel> {
    const contentPath = resolve(libraryPackage.rootPath, "dist", "highstate.library.msgpack")

    try {
      const contentBuffer = await readFile(contentPath)
      const content = decode(contentBuffer) as LibraryModel

      return content
    } catch (error) {
      this.logger.debug(
        { error },
        `failed to read highstate library content of package: "%s"`,
        libraryPackage.name,
      )

      return { components: {}, entities: {} }
    }
  }

  private async loadLibraryPackages(names: string[], installIfNotFound = false): Promise<void> {
    this.logger.debug("loading library packages: %s", names.join(", "))

    const missingPackages: string[] = []

    const worker = this.createPackageResolutionWorker({ packageNames: names })
    for await (const [event] of on(worker, "message")) {
      const eventData = event as PackageResolutionResponse

      if (eventData.type !== "result") {
        continue
      }

      for (const result of eventData.results) {
        if (result.type === "success") {
          const libraryPackage = await this.registerLibraryPackage(
            result.packageRootPath,
            result.packageName,
          )

          if (libraryPackage) {
            this.logger.info(`loaded library package: "%s"`, libraryPackage.name)
          }
        } else if (result.type === "not-found") {
          missingPackages.push(result.packageName)
        } else {
          this.logger.error(
            `failed to load library package "%s": %s`,
            result.packageName,
            result.error,
          )
        }
      }

      break
    }

    if (installIfNotFound && missingPackages.length > 0) {
      this.logger.info("installing missing library packages: %s", missingPackages.join(", "))
      await addDependency(missingPackages)
      await this.loadLibraryPackages(missingPackages)
    }
  }

  private async handleFileEvent(path: string): Promise<void> {
    try {
      const libraryPackage = await this.resolveLibraryPackageForPath(path)

      if (!libraryPackage) {
        return
      }

      if (!libraryPackage.isHighstateManaged) {
        this.logIgnoredPackage(
          libraryPackage.name,
          "skipping file event for non Highstate-managed package",
        )

        return
      }

      if (!this.configBuildOnChanges) {
        return
      }

      this.schedulePackageRebuild(libraryPackage.name)
    } catch (error) {
      this.logger.error({ error, path }, "failed to schedule library package rebuild")
    }
  }

  private async resolveLibraryPackageForPath(path: string): Promise<LibraryPackage | null> {
    const existingPackage = Array.from(this.packages.values()).find(pkg =>
      path.startsWith(pkg.rootPath),
    )

    if (existingPackage) {
      return existingPackage
    }

    let packageJsonPath: string

    try {
      packageJsonPath = await resolvePackageJSON(path)
    } catch (error) {
      this.logger.debug({ error }, `failed to resolve package.json for path: "%s"`, path)
      return null
    }

    const packageRootPath = dirname(packageJsonPath)

    const alreadyLoaded = Array.from(this.packages.values()).find(
      pkg => pkg.rootPath === packageRootPath,
    )

    if (alreadyLoaded) {
      return alreadyLoaded
    }

    return await this.registerLibraryPackage(packageRootPath)
  }

  private schedulePackageRebuild(packageName: string): void {
    const state = this.rebuildStates.get(packageName) ?? { inProgress: false, pending: false }

    // if both in progress and pending, discard this request
    if (state.inProgress && state.pending) {
      this.logger.debug(`rebuild in progress and already pending for "%s", discarding`, packageName)
      return
    }

    // if in progress but no pending, mark as pending
    if (state.inProgress && !state.pending) {
      state.pending = true
      this.rebuildStates.set(packageName, state)
      this.logger.debug(`rebuild in progress, scheduling pending rebuild for "%s"`, packageName)
      return
    }

    // not in progress, enqueue rebuild
    state.inProgress = true
    this.rebuildStates.set(packageName, state)

    void this.buildQueue.add(async () => {
      try {
        await this.executePackageRebuild(packageName)
      } finally {
        state.inProgress = false

        if (state.pending) {
          state.pending = false
          this.schedulePackageRebuild(packageName)
        } else {
          this.rebuildStates.delete(packageName)
        }
      }
    })
  }

  private async executePackageRebuild(packageName: string): Promise<void> {
    const libraryPackage = this.packages.get(packageName)

    if (!libraryPackage) {
      this.logger.warn(`package not found for rebuild: "%s"`, packageName)
      return
    }

    await this.rebuildLibraryPackage(libraryPackage)

    if (this.libraryPackages.includes(libraryPackage.name)) {
      this.logger.info("reloading library due to file change in package: %s", libraryPackage.name)
      await this.reloadLibrary()
    }
  }

  private async initialize(): Promise<void> {
    const workspacePackages = await this.collectWorkspacePackages()

    if (workspacePackages.length === 0) {
      return
    }

    const managedPackageNames = new Set<string>()

    await this.lock.acquire(async () => {
      for (const workspacePackage of workspacePackages) {
        const registered = await this.registerLibraryPackage(
          workspacePackage.rootPath,
          workspacePackage.packageJson.name,
          workspacePackage.packageJson,
        )

        if (registered?.isHighstateManaged) {
          managedPackageNames.add(registered.name)
        }
      }
    })

    if (!this.configBuildOnStartup) {
      return
    }

    for (const packageName of managedPackageNames) {
      this.schedulePackageRebuild(packageName)
    }
  }

  private async collectWorkspacePackages(): Promise<
    Array<{ rootPath: string; packageJson: PackageJson }>
  > {
    if (this.workspacePatterns.length === 0) {
      this.logger.warn(
        { workspaceRoot: this.workspacePath },
        "workspace root does not define workspaces; skipping startup builds",
      )

      return []
    }

    return await this.expandWorkspacePatterns(this.workspacePath, this.workspacePatterns)
  }

  private async expandWorkspacePatterns(
    rootPath: string,
    patterns: string[],
  ): Promise<Array<{ rootPath: string; packageJson: PackageJson }>> {
    const includePatterns = patterns.filter(pattern => !pattern.startsWith("!"))
    const excludePatterns = patterns
      .filter(pattern => pattern.startsWith("!"))
      .map(pattern => pattern.slice(1))

    if (includePatterns.length === 0) {
      return []
    }

    let matches: string[] = []

    try {
      matches = await glob(includePatterns, {
        cwd: rootPath,
        absolute: true,
        dot: false,
        ignore: excludePatterns,
      })
    } catch (error) {
      this.logger.error({ error, rootPath }, "failed to expand workspace patterns")
      return []
    }

    const results: Array<{ rootPath: string; packageJson: PackageJson }> = []
    const seen = new Set<string>()

    for (const match of matches) {
      const packageDir = match.endsWith("package.json") ? dirname(match) : match

      if (seen.has(packageDir)) {
        continue
      }

      const packageJson = await this.tryReadPackageJson(packageDir)

      if (!packageJson) {
        continue
      }

      seen.add(packageDir)
      results.push({ rootPath: packageDir, packageJson })
    }

    return results
  }

  private async tryReadPackageJson(directory: string): Promise<PackageJson | null> {
    try {
      return await readPackageJSON(directory)
    } catch (error) {
      this.logger.trace(
        { error, directory },
        "failed to read package.json while resolving workspaces",
      )

      return null
    }
  }

  private static extractWorkspacePatterns(packageJson: PackageJson): string[] {
    const workspaces = packageJson.workspaces

    if (!workspaces) {
      return []
    }

    if (Array.isArray(workspaces)) {
      return workspaces
    }

    if (
      typeof workspaces === "object" &&
      Array.isArray((workspaces as Record<string, unknown>).packages)
    ) {
      return (workspaces as { packages: string[] }).packages
    }

    return []
  }

  private static async resolveWorkspaceConfig(
    explicitWorkspace: string | undefined,
    projectRoot: string,
    logger: Logger,
  ): Promise<{ root: string; patterns: string[] }> {
    if (explicitWorkspace) {
      const workspaceRoot = resolve(explicitWorkspace)

      try {
        const packageJson = await readPackageJSON(workspaceRoot)
        const patterns = LocalLibraryBackend.extractWorkspacePatterns(packageJson)

        if (patterns.length === 0) {
          logger.warn(
            { workspaceRoot },
            "configured workspace does not define workspaces; skipping startup builds",
          )
        }

        return { root: workspaceRoot, patterns }
      } catch (error) {
        logger.warn(
          { error, workspaceRoot },
          "failed to read configured workspace package.json; skipping startup builds",
        )

        return { root: workspaceRoot, patterns: [] }
      }
    }

    const detected = await LocalLibraryBackend.findWorkspaceRootForPath(projectRoot)

    if (detected) {
      return detected
    }

    logger.warn(
      { projectRoot },
      'no workspace root with "workspaces" field detected; skipping startup builds',
    )

    return { root: projectRoot, patterns: [] }
  }

  private static async findWorkspaceRootForPath(
    startPath: string,
  ): Promise<{ root: string; patterns: string[] } | null> {
    let current = startPath
    const visited = new Set<string>()

    while (!visited.has(current)) {
      visited.add(current)

      try {
        const packageJson = await readPackageJSON(current)
        const patterns = LocalLibraryBackend.extractWorkspacePatterns(packageJson)

        if (patterns.length > 0) {
          return { root: current, patterns }
        }
      } catch {
        // ignore and continue traversing upwards
      }

      const parent = dirname(current)

      if (parent === current) {
        break
      }

      current = parent
    }

    return null
  }

  private createLibraryWorker(workerData: WorkerData): Worker {
    const workerPathUrl = importMetaResolve(`@highstate/backend/library-worker`, import.meta.url)
    const workerPath = fileURLToPath(workerPathUrl)

    return new Worker(workerPath, { workerData })
  }

  private createPackageResolutionWorker(workerData: PackageResolutionWorkerData) {
    const workerPathUrl = importMetaResolve(
      `@highstate/backend/package-resolution-worker`,
      import.meta.url,
    )
    const workerPath = fileURLToPath(workerPathUrl)

    return new Worker(workerPath, { workerData })
  }

  static async create(config: z.infer<typeof localLibraryBackendConfig>, logger: Logger) {
    const [projectPath] = await resolveMainLocalProject()

    const workspaceConfig = await LocalLibraryBackend.resolveWorkspaceConfig(
      config.HIGHSTATE_LIBRARY_BACKEND_LOCAL_WORKSPACE_PATH,
      projectPath,
      logger,
    )

    const backend = new LocalLibraryBackend(
      config.HIGHSTATE_LIBRARY_BACKEND_LOCAL_LIBRARY_PACKAGES,
      workspaceConfig.root,
      workspaceConfig.patterns,
      config.HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_CONCURRENCY,
      config.HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_STARTUP,
      config.HIGHSTATE_LIBRARY_BACKEND_LOCAL_BUILD_ON_CHANGES,
      logger.child({ backend: "LibraryBackend", service: "LocalLibraryBackend" }),
    )

    void backend
      .initialize()
      .catch(error => logger.error({ error }, "failed to initialize LocalLibraryBackend"))

    return backend
  }
}
