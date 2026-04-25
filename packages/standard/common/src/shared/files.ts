import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { cp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { basename, dirname, extname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  type CommonObjectMeta,
  cuidv2d,
  getEntityId,
  getOrCreate,
  HighstateSignature,
  isSecret,
} from "@highstate/contract"
import { common, type network } from "@highstate/library"
import {
  asset,
  type FileOptions,
  getUnitTempPath,
  makeEntity,
  makeFileAsync,
  toPromise,
} from "@highstate/pulumi"
import { createId } from "@paralleldrive/cuid2"
import { minimatch } from "minimatch"
import * as tar from "tar"
import unzipper from "unzipper"
import { emptyLifetimeScope, getOrCreateLifetimeScope, LifetimeScopeContainer } from "./lifetime"
import { type InputL7Endpoint, l7EndpointToString, parseEndpoint } from "./network/endpoints"

export type FolderPackOptions = {
  /**
   * The patterns to include in the packed archive.
   * If not provided, all files and folders will be included.
   */
  include?: string[]

  /**
   * The patterns to exclude from the packed archive.
   * Applied after include patterns.
   * If not provided, no files or folders will be excluded.
   */
  exclude?: string[]
}

/**
 * Creates Pulumi asset from Highstate file.
 *
 * @param file The file entity to create the asset from.
 * @returns The created asset.
 */
export function assetFromFile(file: common.File): asset.Asset {
  if (file.content.type === "remote") {
    return new asset.RemoteAsset(l7EndpointToString(file.content.endpoint))
  }

  if (file.content.type === "artifact") {
    throw new Error(
      "Artifact-based files cannot be converted to Pulumi assets directly. Use MaterializedFile instead.",
    )
  }

  if (file.content.isBinary) {
    throw new Error(
      "Cannot create asset from inline binary file content. Please open an issue if you need this feature.",
    )
  }

  return new asset.StringAsset(
    isSecret(file.content.value) ? file.content.value.value : file.content.value,
  )
}

/**
 * Creates Pulumi archive from Highstate folder.
 *
 * @param folder The folder entity to create the asset archive from.
 * @returns The created asset archive.
 */
export function archiveFromFolder(folder: common.Folder): asset.Archive {
  if (folder.content.type === "remote") {
    return new asset.RemoteArchive(l7EndpointToString(folder.content.endpoint))
  }

  if (folder.content.type === "local") {
    return new asset.FileArchive(folder.content.path)
  }

  if (folder.content.type === "artifact") {
    throw new Error(
      "Artifact-based folders cannot be converted to Pulumi assets directly. Use MaterializedFolder instead.",
    )
  }

  const files: Record<string, asset.Asset> = {}

  for (const file of folder.files) {
    files[file.meta.name] = assetFromFile(file)
  }

  for (const subfolder of folder.folders) {
    files[subfolder.meta.name] = archiveFromFolder(subfolder)
  }

  return new asset.AssetArchive(files)
}

/**
 * Extracts a tar or zip archive from a stream to a destination directory.
 *
 * @param stream The stream containing the archive data
 * @param destinationPath The path where to extract the archive
 * @param archiveType The type of archive ('tar' or 'zip')
 */
async function unarchiveFromStream(
  stream: Readable,
  destinationPath: string,
  archiveType: "tar" | "zip",
): Promise<void> {
  await mkdir(destinationPath, { recursive: true })

  switch (archiveType) {
    case "tar": {
      const extractStream = tar.extract({
        cwd: destinationPath,
        strict: true,
      })

      await pipeline(stream, extractStream)
      return
    }
    case "zip": {
      // Extract directly from stream using unzipper
      await pipeline(stream, unzipper.Extract({ path: destinationPath }))
      return
    }
  }
}

/**
 * Determines the archive type based on file extension or content type.
 *
 * @param fileName The name of the file
 * @param contentType Optional content type from HTTP headers
 * @returns The detected archive type or null if not an archive
 */
function detectArchiveType(fileName: string, contentType?: string): "tar" | "zip" | null {
  const ext = extname(fileName).toLowerCase()

  if (ext === ".tar" || ext === ".tgz" || ext === ".tar.gz") {
    return "tar"
  }

  if (ext === ".zip") {
    return "zip"
  }

  // Fallback to content type
  if (contentType) {
    if (contentType.includes("tar") || contentType.includes("gzip")) {
      return "tar"
    }
    if (contentType.includes("zip")) {
      return "zip"
    }
  }

  return null
}

const materializationNamespace = "ba1fd72c-85e3-4e4a-9047-2700262a933f"

const materializedFiles = new Map<string, MaterializedFile>()
const materializedFolders = new Map<string, MaterializedFolder>()

function getMaterializationId(entity: common.File | common.Folder, instance = "default"): string {
  return cuidv2d(materializationNamespace, `${getEntityId(entity)}:${instance}`)
}

export type MaterializationAction = () => Promise<void> | void

async function runMaterializationActions(
  entity: common.File | common.Folder,
  actions: MaterializationAction[],
): Promise<void> {
  for (const action of actions) {
    try {
      await action()
    } catch (error) {
      console.error(`error executing materialization action for file "${entity.meta.name}":`, error)

      throw new Error(`Failed to execute materialization action for file "${entity.meta.name}"`)
    }
  }
}

/**
 * The `MaterializedFile` class represents a file entity that has been materialized
 * to a local filesystem path.
 *
 * It handles creating a temporary directory, writing the file content to that directory,
 * and cleaning up the temporary files when disposed.
 */
export class MaterializedFile extends LifetimeScopeContainer {
  readonly artifactMeta: CommonObjectMeta

  readonly _materializationPath?: string
  readonly _materializationActions: MaterializationAction[] = []
  private _rootRef?: AsyncDisposable

  /**
   * The stable path of the materialized file on the local filesystem.
   *
   * If parentId is provided, it is calculated as `{parent.path}/{entity.meta.name}`.
   *
   * If file is materialized independently without a parent folder, the path is calculated as `/tmp/highstate/{stateId}/files/{materializationId}/{fileName}`.
   * The location does not change between invocations of the unit for the same file entity, parent folder and instance name.
   */
  readonly path: string

  private constructor(
    /**
     * The Highstate file entity that this materialized file represents.
     */
    readonly entity: common.File,

    /**
     * The stable ID for this materialized file instance.
     *
     * If parentId is provided, this will be `undefined` since the materialization is scoped to the parent folder and does not need a separate ID.
     *
     * If no parentId is provided, it is calculated as `cuidv2d("ba1fd72c-85e3-4e4a-9047-2700262a933f", "{entityId}:{instance}")`.
     */
    readonly materializationId?: string,

    /**
     * The parent folder to materialize the file in. If not provided, the file will be materialized in an independent temporary directory.
     */
    readonly parent?: MaterializedFolder,
  ) {
    if (materializationId && parent) {
      throw new Error("Materialization ID must not be provided for files with a parent folder")
    }

    if (!materializationId && !parent) {
      throw new Error("Materialization ID must be provided for files without a parent folder")
    }

    // create lifetime scope if materializationId is provided, otherwise use empty scope since the lifetime will be managed by the parent folder
    const scope = materializationId
      ? getOrCreateLifetimeScope(
          `materialized-file-${materializationId}`,
          () => this._open(),
          () => this._dispose(),
        )
      : emptyLifetimeScope

    super(scope)

    this.artifactMeta = {
      title: entity.$meta.title ?? `Materialized file "${entity.meta.name}"`,
      description: entity.$meta.description,
      icon: entity.$meta.icon,
      iconColor: entity.$meta.iconColor,
    }

    this._materializationPath = parent
      ? undefined
      : join(getUnitTempPath(), "files", materializationId!)

    this.path = parent
      ? join(parent.path, entity.meta.name)
      : join(this._materializationPath!, entity.meta.name)
  }

  /**
   * Opens the materialized file and returns a reference that ensures the file stays materialized while it's in use.
   *
   * Example usage:
   * ```
   * await using _ = await file.open()
   * // do something with the file until the end of the scope
   * // it will be automatically disposed if no more references to it exist
   * ```
   */
  async open() {
    return this.scope.ref()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this._rootRef) {
      await this._rootRef[Symbol.asyncDispose]()
      this._rootRef = undefined
    }
  }

  /**
   * Sets the action to be performed when the file is materialized.
   *
   * Must be called before calling `open()` or before passing `hooks` to other resources, otherwise the action might not be executed.
   *
   * Also note that multiple code parts may set materialization actions for the same file.
   * If actions must be isolated, consider passing different `instance` values when creating materialized file.
   */
  onMaterialized(action: MaterializationAction): void {
    this._materializationActions.push(action)
  }

  private async _open(): Promise<void> {
    if (this._materializationPath) {
      // ensure the materialization directory exists before writing the file
      await mkdir(this._materializationPath, { recursive: true })
    }

    switch (this.entity.content.type) {
      case "embedded": {
        const content = this.entity.content.isBinary
          ? Buffer.from(this.entity.content.value, "base64")
          : this.entity.content.value

        await writeFile(this.path, content, { mode: this.entity.meta.mode })
        break
      }
      case "embedded-secret": {
        const content = this.entity.content.isBinary
          ? Buffer.from(this.entity.content.value.value, "base64")
          : this.entity.content.value.value

        await writeFile(this.path, content, { mode: this.entity.meta.mode })
        break
      }
      case "remote": {
        const response = await fetch(l7EndpointToString(this.entity.content.endpoint))
        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)

        const arrayBuffer = await response.arrayBuffer()
        await writeFile(this.path, Buffer.from(arrayBuffer), { mode: this.entity.meta.mode })

        break
      }
      case "artifact": {
        const artifactPath = process.env.HIGHSTATE_ARTIFACT_READ_PATH
        if (!artifactPath) {
          throw new Error(
            "HIGHSTATE_ARTIFACT_READ_PATH environment variable is not set but required for artifact content",
          )
        }

        const tgzPath = join(artifactPath, `${this.entity.content.hash}.tgz`)

        // extract the tgz file directly to the target path
        const readStream = createReadStream(tgzPath)
        await unarchiveFromStream(readStream, dirname(this.path), "tar")
        break
      }
    }

    // execute materialization actions
    await runMaterializationActions(this.entity, this._materializationActions)
  }

  private async _dispose(): Promise<void> {
    try {
      if (this._materializationPath) {
        // clear the whole materialization directory if it was created
        await rm(this._materializationPath, { recursive: true, force: true })
      } else {
        // otherwise, just remove the file
        await rm(this.path, { force: true })
      }
    } catch (error) {
      // ignore errors during cleanup, as the file might have been already removed
      // or the temporary directory might not exist
      // TODO: centralized logging for unit code
      console.warn("failed to clean up materialized file:", error)
    }
  }

  /**
   * Packs the materialized file into an artifact and returns the file entity with artifact content.
   *
   * Creates a tgz archive of the file and stores it in HIGHSTATE_ARTIFACT_WRITE_PATH where it will be collected by Highstate.
   */
  async pack(): Promise<common.ArtifactFile> {
    await using _ = await this.open()

    const writeDir = process.env.HIGHSTATE_ARTIFACT_WRITE_PATH
    if (!writeDir) {
      throw new Error("HIGHSTATE_ARTIFACT_WRITE_PATH environment variable is not set")
    }

    // read actual file stats from filesystem
    const fileStats = await stat(this.path)

    // create tgz archive of the file
    const tempArchivePath = join(getUnitTempPath(), `pack-${createId()}.tgz`)

    try {
      await tar.create(
        {
          gzip: true,
          file: tempArchivePath,
          cwd: dirname(this.path),
          noMtime: true, // to reproduce the same archive every time
        },
        [basename(this.path)],
      )

      // calculate hash of the archive
      const fileContent = createReadStream(tempArchivePath)
      const hash = createHash("sha256")

      for await (const chunk of fileContent) {
        hash.update(chunk as Buffer)
      }

      const hashValue = hash.digest("hex")

      // move archive to write directory with hash name
      const finalArchivePath = join(writeDir, `${hashValue}.tgz`)
      await rename(tempArchivePath, finalArchivePath)

      const newMeta = {
        name: this.entity.meta.name,
        mode: fileStats.mode & 0o777, // extract only permission bits
        size: fileStats.size,
      }

      // return file entity with artifact content using actual filesystem stats
      return makeEntity({
        entity: common.fileEntity,
        identity: this.entity.$meta.identity,
        meta: {
          title: this.entity.meta.name,
        },
        value: {
          meta: newMeta,
          content: {
            type: "artifact" as const,
            [HighstateSignature.Artifact]: true,
            hash: hashValue,
            meta: await toPromise(this.artifactMeta),
          },
        },
      }) as common.ArtifactFile
    } finally {
      // clean up temporary archive
      try {
        await rm(tempArchivePath, { force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  }

  /**
   * Returns a materialized file instance for the given file entity.
   * For each combination of (file, instance) the same materialized file instance will be returned.
   *
   * @param file The file entity to materialize.
   * @param instance Optional instance name to differentiate multiple materializations of the same file. Can be used to isolate different operations on the same file. By default, "default".
   */
  static for(file: common.File, instance?: string): MaterializedFile {
    const materializationId = getMaterializationId(file, instance)

    return getOrCreate(
      materializedFiles,
      materializationId,
      () => new MaterializedFile(file, materializationId),
    )
  }

  /**
   * Opens a materialized file and returns the materialized instance.
   *
   * @param file The file entity to materialize.
   * @param parent Optional parent folder for nested materialization.
   * @param instance Optional instance name when materializing without parent.
   */
  // biome-ignore lint/suspicious/useAdjacentOverloadSignatures: class intentionally provides both instance and static open APIs
  static async open(
    file: common.File,
    parent?: MaterializedFolder,
    instance?: string,
  ): Promise<MaterializedFile> {
    if (parent) {
      const materializedFile = new MaterializedFile(file, undefined, parent)

      try {
        await materializedFile._open()
      } catch (error) {
        await materializedFile._dispose()
        throw error
      }

      return materializedFile
    }

    const materializedFile = MaterializedFile.for(file, instance)

    try {
      if (!materializedFile._rootRef) {
        materializedFile._rootRef = await materializedFile.open()
      }
    } catch (error) {
      await materializedFile[Symbol.asyncDispose]()
      throw error
    }

    return materializedFile
  }

  /**
   * Creates and opens a materialized file from makeFile-compatible options.
   *
   * @param options The file options with the same shape as makeFile.
   * @param parent Optional parent folder for nested materialization.
   * @param instance Optional instance name when materializing without parent.
   */
  static async create(
    options: FileOptions,
    parent?: MaterializedFolder,
    instance?: string,
  ): Promise<MaterializedFile> {
    const file = await makeFileAsync(options)

    return await MaterializedFile.open(file, parent, instance)
  }
}

/**
 * The `MaterializedFolder` class represents a folder entity that has been materialized
 * to a local filesystem path.
 *
 * It handles creating a temporary directory, copying the folder content to that directory,
 * and cleaning up the temporary files when disposed.
 */
export class MaterializedFolder extends LifetimeScopeContainer {
  readonly artifactMeta: CommonObjectMeta

  readonly _materializationPath?: string
  readonly _materializationActions: MaterializationAction[] = []
  private _rootRef?: AsyncDisposable

  /**
   * The stable path of the materialized folder on the local filesystem.
   *
   * If parentId is provided, it is calculated as `{parent.path}/{entity.meta.name}`.
   *
   * If folder is materialized independently without a parent folder, the path is calculated as `/tmp/highstate/{stateId}/folders/{materializationId}/{folderName}`.
   * The location does not change between invocations of the unit for the same folder entity, parent folder and instance name.
   */
  readonly path: string

  private constructor(
    /**
     * The Highstate folder entity that this materialized folder represents.
     */
    readonly entity: common.Folder,

    /**
     * The stable ID for this materialized folder instance. Must be provided if the folder is materialized independently without a parent folder.
     * If parentId is provided, this will be `undefined` since the materialization is scoped to the parent folder and does not need a separate ID.
     */
    readonly materializationId?: string,

    /**
     * The parent folder to materialize the folder in. If not provided, the folder will be materialized in an independent temporary directory.
     */
    readonly parent?: MaterializedFolder,
  ) {
    if (materializationId && parent) {
      throw new Error("Materialization ID must not be provided for folders with a parent folder")
    }

    if (!materializationId && !parent) {
      throw new Error("Materialization ID must be provided for folders without a parent folder")
    }

    // create lifetime scope if materializationId is provided, otherwise use empty scope since the lifetime will be managed by the parent folder
    const scope = materializationId
      ? getOrCreateLifetimeScope(
          `materialized-folder-${materializationId}`,
          () => this._open(),
          () => this._dispose(),
        )
      : emptyLifetimeScope

    super(scope)

    this.artifactMeta = {
      title: entity.$meta.title ?? `Materialized folder "${entity.meta.name}"`,
      description: entity.$meta.description,
      icon: entity.$meta.icon,
      iconColor: entity.$meta.iconColor,
    }

    this._materializationPath = parent
      ? undefined
      : join(getUnitTempPath(), "folders", materializationId!)

    this.path = parent ? join(parent.path, entity.meta.name) : this._materializationPath!
  }

  /**
   * Opens the materialized folder and returns a reference that ensures the folder stays materialized while it's in use.
   *
   * Example usage:
   * ```
   * await using _ = await folder.open()
   * // do something with the folder until the end of the scope
   * // it will be automatically disposed if no more references to it exist
   * ```
   */
  async open() {
    return this.scope.ref()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this._rootRef) {
      await this._rootRef[Symbol.asyncDispose]()
      this._rootRef = undefined
    }
  }

  /**
   * Sets the action to be performed when the folder is materialized.
   *
   * Must be called before calling `open()` or before passing `hooks` to other resources, otherwise the action might not be executed.
   *
   * Also note that multiple code parts may set materialization actions for the same folder.
   * If actions must be isolated, consider passing different `instance` values when creating materialized folder.
   */
  onMaterialized(action: MaterializationAction): void {
    this._materializationActions.push(action)
  }

  private async _open(): Promise<void> {
    switch (this.entity.content.type) {
      case "embedded": {
        // create the folder itself
        await mkdir(this.path, { recursive: true, mode: this.entity.meta.mode })

        for (const file of this.entity.files) {
          // @ts-expect-error bypass constructor visibility
          const materializedFile = new MaterializedFile(file, undefined, this)
          await materializedFile.open()
        }

        for (const subfolder of this.entity.folders) {
          const materializedFolder = new MaterializedFolder(subfolder, undefined, this)
          await materializedFolder._open()
        }

        break
      }
      case "local": {
        // Check if the local path is an archive file that needs extraction
        const archiveType = detectArchiveType(this.entity.content.path)

        if (archiveType) {
          // Extract archive to the destination path
          const readStream = createReadStream(this.entity.content.path)
          await unarchiveFromStream(readStream, this.path, archiveType)
        } else {
          // Regular directory copy
          await cp(this.entity.content.path, this.path, {
            recursive: true,
            mode: this.entity.meta.mode,
          })
        }

        break
      }
      case "remote": {
        const response = await fetch(l7EndpointToString(this.entity.content.endpoint))
        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)
        if (!response.body) throw new Error("Response body is empty")

        // Try to detect archive type from URL or content type
        const url = new URL(l7EndpointToString(this.entity.content.endpoint))
        const archiveType = detectArchiveType(
          url.pathname,
          response.headers.get("content-type") || undefined,
        )

        if (!archiveType) {
          throw new Error("Remote folder content must be an archive (tar, tar.gz, tgz, or zip)")
        }

        if (!response.body) {
          throw new Error("Response body is empty")
        }

        const reader = response.body.getReader()
        const stream = new Readable({
          async read() {
            try {
              const { done, value } = await reader.read()
              if (done) {
                this.push(null)
              } else {
                this.push(Buffer.from(value))
              }
            } catch (error) {
              this.destroy(error instanceof Error ? error : new Error(String(error)))
            }
          },
        })

        await unarchiveFromStream(stream, this.path, archiveType)

        break
      }
      case "artifact": {
        const artifactPath = process.env.HIGHSTATE_ARTIFACT_READ_PATH

        if (!artifactPath) {
          throw new Error(
            "HIGHSTATE_ARTIFACT_READ_PATH environment variable is not set but required for artifact content",
          )
        }

        const tgzPath = join(artifactPath, `${this.entity.content.hash}.tgz`)

        // extract the tgz file directly to the target path
        const readStream = createReadStream(tgzPath)
        await unarchiveFromStream(readStream, dirname(this.path), "tar")

        break
      }
    }

    // execute materialization actions
    await runMaterializationActions(this.entity, this._materializationActions)
  }

  private async _dispose(): Promise<void> {
    try {
      if (this._materializationPath) {
        // clear the whole materialization directory if it was created
        await rm(this._materializationPath, { recursive: true, force: true })
      } else {
        // otherwise, just remove the folder
        await rm(this.path, { recursive: true, force: true })
      }
    } catch (error) {
      // ignore errors during cleanup, as the folder might have been already removed
      // or the temporary directory might not exist
      // TODO: centralized logging for unit code
      console.warn("failed to clean up materialized folder:", error)
    }
  }

  /**
   * Packs the materialized folder into an artifact and returns the folder entity with artifact content.
   *
   * Creates a tgz archive of the entire folder and stores it in HIGHSTATE_ARTIFACT_WRITE_PATH where it will be collected by Highstate.
   */
  async pack({ include, exclude }: FolderPackOptions = {}): Promise<common.ArtifactFolder> {
    await using _ = await this.open()

    const writeDir = process.env.HIGHSTATE_ARTIFACT_WRITE_PATH
    if (!writeDir) {
      throw new Error("HIGHSTATE_ARTIFACT_WRITE_PATH environment variable is not set")
    }

    // read actual folder stats from filesystem
    const folderStats = await stat(this.path)

    // create tgz archive of the folder
    const tempArchivePath = join(getUnitTempPath(), `pack-${createId()}.tgz`)

    const entity = this.entity

    try {
      await tar.create(
        {
          gzip: true,
          file: tempArchivePath,
          cwd: dirname(this.path),

          filter(path) {
            // match without the folder name prefix
            path = path.slice(entity.meta.name.length + 1)

            // handle explicit excludes
            for (const pattern of exclude ?? []) {
              if (minimatch(path, pattern)) {
                return false
              }
            }

            // try to match include patterns
            for (const pattern of include ?? []) {
              if (minimatch(path, pattern)) {
                return true
              }
            }

            // include all files if no include patterns are specified
            return !include || include.length === 0
          },

          // to reproduce the same archive every time
          portable: true,
          noMtime: true,
        },
        [basename(this.path)],
      )

      // calculate hash of the archive
      const fileContent = createReadStream(tempArchivePath)
      const hash = createHash("sha256")

      for await (const chunk of fileContent) {
        hash.update(chunk as Buffer)
      }

      const hashValue = hash.digest("hex")

      // move archive to write directory with hash name
      const finalArchivePath = join(writeDir, `${hashValue}.tgz`)
      await rename(tempArchivePath, finalArchivePath)

      const newMeta = {
        name: this.entity.meta.name,
        mode: folderStats.mode & 0o777, // extract only permission bits
      }

      // return folder entity with artifact content using actual filesystem stats
      return makeEntity({
        entity: common.folderEntity,
        identity: this.entity.$meta.identity,
        meta: {
          title: this.entity.meta.name,
        },
        value: {
          meta: newMeta,
          content: {
            [HighstateSignature.Artifact]: true,
            type: "artifact",
            hash: hashValue,
            meta: await toPromise(this.artifactMeta),
          },
        },
      }) as common.ArtifactFolder
    } finally {
      // clean up temporary archive
      try {
        await rm(tempArchivePath, { force: true })
      } catch {
        // ignore cleanup errors
      }
    }
  }

  /**
   * Returns a materialized folder instance for the given folder entity.
   * For each combination of (folder, instance) the same materialized folder instance will be returned.
   *
   * @param folder The folder entity to materialize.
   * @param instance Optional instance name to differentiate multiple materializations of the same folder. Can be used to isolate different operations on the same folder. By default, "default".
   */
  static for(folder: common.Folder, instance?: string): MaterializedFolder {
    const materializationId = getMaterializationId(folder, instance)

    return getOrCreate(
      materializedFolders,
      materializationId,
      () => new MaterializedFolder(folder, materializationId),
    )
  }

  /**
   * Opens a materialized folder and returns the materialized instance.
   *
   * @param folder The folder entity to materialize.
   * @param parent Optional parent folder for nested materialization.
   * @param instance Optional instance name when materializing without parent.
   */
  // biome-ignore lint/suspicious/useAdjacentOverloadSignatures: class intentionally provides both instance and static open APIs
  static async open(
    folder: common.Folder,
    parent?: MaterializedFolder,
    instance?: string,
  ): Promise<MaterializedFolder> {
    if (parent) {
      const materializedFolder = new MaterializedFolder(folder, undefined, parent)

      try {
        await materializedFolder._open()
      } catch (error) {
        await materializedFolder._dispose()
        throw error
      }

      return materializedFolder
    }

    const materializedFolder = MaterializedFolder.for(folder, instance)

    try {
      if (!materializedFolder._rootRef) {
        materializedFolder._rootRef = await materializedFolder.open()
      }
    } catch (error) {
      await materializedFolder[Symbol.asyncDispose]()
      throw error
    }

    return materializedFolder
  }
}

/**
 * Fetches the size of a file from a given L7 endpoint.
 *
 * @param endpoint The L7 endpoint to fetch the file size from.
 * @returns The size of the file in bytes.
 * @throws If the protocol is not HTTP/HTTPS or if the request fails.
 */
export async function fetchFileSize(endpoint: network.L7Endpoint): Promise<number> {
  if (endpoint.appProtocol !== "http" && endpoint.appProtocol !== "https") {
    throw new Error(
      `Unsupported protocol: ${endpoint.appProtocol}. Only HTTP and HTTPS are supported.`,
    )
  }

  const url = l7EndpointToString(endpoint)
  const response = await fetch(url, { method: "HEAD" })

  if (!response.ok) {
    throw new Error(`Failed to fetch file size: ${response.statusText}`)
  }

  const contentLength = response.headers.get("content-length")
  if (!contentLength) {
    throw new Error("Content-Length header is missing in the response")
  }

  const size = parseInt(contentLength, 10)
  if (Number.isNaN(size)) {
    throw new Error(`Invalid Content-Length value: ${contentLength}`)
  }

  return size
}

/**
 * Extracts the name from an L7 endpoint URL without its file extension.
 */
export function getNameByEndpoint(endpoint: InputL7Endpoint): string {
  const parsedEndpoint = parseEndpoint(endpoint, 7)

  return parsedEndpoint.path ? basename(parsedEndpoint.path) : ""
}
