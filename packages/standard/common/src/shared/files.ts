import type { common, network } from "@highstate/library"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { cp, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, extname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { type CommonObjectMeta, HighstateSignature } from "@highstate/contract"
import { asset, type Input, toPromise } from "@highstate/pulumi"
import { minimatch } from "minimatch"
import * as tar from "tar"
import unzipper from "unzipper"
import { type InputL7Endpoint, l7EndpointToString, parseL7Endpoint } from "./network"

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

  if (file.content.type === "local") {
    return new asset.FileAsset(file.content.path)
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

  return new asset.StringAsset(file.content.value)
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

  for (const file of folder.content.files) {
    files[file.meta.name] = assetFromFile(file)
  }

  for (const subfolder of folder.content.folders) {
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

/**
 * The `MaterializedFile` class represents a file entity that has been materialized
 * to a local filesystem path.
 *
 * It handles creating a temporary directory, writing the file content to that directory,
 * and cleaning up the temporary files when disposed.
 *
 * For improved cleanup reliability, the class will use HIGHSTATE_TEMP_PATH as the base
 * directory for temporary files if available, allowing for centralized cleanup by the runner.
 */
export class MaterializedFile implements AsyncDisposable {
  private _tmpPath?: string
  private _path!: string
  private _disposed = false

  readonly artifactMeta: CommonObjectMeta

  constructor(
    readonly entity: common.File,
    readonly parent?: MaterializedFolder,
  ) {
    this.artifactMeta = {
      title: `Materialized file "${entity.meta.name}"`,
    }
  }

  get path(): string {
    return this._path
  }

  private async _open(): Promise<void> {
    if (this.parent) {
      // if the parent folder is provided, the file path is relative to the parent folder
      this._path = join(this.parent.path, this.entity.meta.name)
    } else {
      // otherwise, the file path is in a temporary directory
      // use HIGHSTATE_TEMP_PATH as base if available for better cleanup reliability
      const tempBase = process.env.HIGHSTATE_TEMP_PATH || tmpdir()
      this._tmpPath = await mkdtemp(join(tempBase, "highstate-file-"))
      this._path = join(this._tmpPath, this.entity.meta.name)
    }

    switch (this.entity.content.type) {
      case "embedded": {
        const content = this.entity.content.isBinary
          ? Buffer.from(this.entity.content.value, "base64")
          : this.entity.content.value

        await writeFile(this._path, content, { mode: this.entity.meta.mode })
        break
      }
      case "local": {
        await cp(this.entity.content.path, this._path, { mode: this.entity.meta.mode })
        break
      }
      case "remote": {
        const response = await fetch(l7EndpointToString(this.entity.content.endpoint))
        if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)

        const arrayBuffer = await response.arrayBuffer()
        await writeFile(this._path, Buffer.from(arrayBuffer), { mode: this.entity.meta.mode })

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
        await unarchiveFromStream(readStream, dirname(this._path), "tar")
        break
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this._disposed) return
    this._disposed = true

    try {
      if (this._tmpPath) {
        // clear the whole temporary directory if it was created
        await rm(this._tmpPath, { recursive: true, force: true })
      } else {
        // otherwise, just remove the file
        await rm(this._path, { force: true })
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
    const writeDir = process.env.HIGHSTATE_ARTIFACT_WRITE_PATH
    if (!writeDir) {
      throw new Error("HIGHSTATE_ARTIFACT_WRITE_PATH environment variable is not set")
    }

    // read actual file stats from filesystem
    const fileStats = await stat(this._path)

    // create tgz archive of the file
    const tempBase = process.env.HIGHSTATE_TEMP_PATH || tmpdir()
    const tempArchivePath = join(tempBase, `highstate-pack-${Date.now()}.tgz`)

    try {
      await tar.create(
        {
          gzip: true,
          file: tempArchivePath,
          cwd: dirname(this._path),
          noMtime: true, // to reproduce the same archive every time
        },
        [basename(this._path)],
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
      return {
        meta: newMeta,
        content: {
          type: "artifact",
          [HighstateSignature.Artifact]: true,
          hash: hashValue,
          meta: await toPromise(this.artifactMeta),
        },
      }
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
   * Creates an empty materialized file with the given name.
   *
   * @param name The name of the file to create
   * @param content Optional initial content of the file (default is empty string)
   * @param mode Optional file mode (permissions)
   * @returns A new MaterializedFile instance representing an empty file
   */
  static async create(name: string, content = "", mode?: number): Promise<MaterializedFile> {
    const entity: common.File = {
      meta: {
        name,
        mode,
        size: 0,
      },
      content: {
        type: "embedded",
        value: content,
      },
    }

    const materializedFile = new MaterializedFile(entity)

    try {
      await materializedFile._open()
    } catch (error) {
      await materializedFile[Symbol.asyncDispose]()
      throw error
    }

    return materializedFile
  }

  static async open(
    file: Input<common.File>,
    parent?: MaterializedFolder,
  ): Promise<MaterializedFile> {
    const resolvedFile = await toPromise(file)
    const materializedFile = new MaterializedFile(resolvedFile, parent)

    try {
      await materializedFile._open()
    } catch (error) {
      await materializedFile[Symbol.asyncDispose]()
      throw error
    }

    return materializedFile
  }
}

/**
 * The `MaterializedFolder` class represents a folder entity that has been materialized
 * to a local filesystem path.
 *
 * It handles creating a temporary directory, copying the folder content to that directory,
 * and cleaning up the temporary files when disposed.
 *
 * For improved cleanup reliability, the class will use HIGHSTATE_TEMP_PATH as the base
 * directory for temporary files if available, allowing for centralized cleanup by the runner.
 */
export class MaterializedFolder implements AsyncDisposable {
  private _tmpPath?: string
  private _path!: string
  private _disposed = false

  private readonly _disposables: AsyncDisposable[] = []

  readonly artifactMeta: CommonObjectMeta

  constructor(
    readonly entity: common.Folder,
    readonly parent?: MaterializedFolder,
  ) {
    this.artifactMeta = {
      title: `Materialized folder "${entity.meta.name}"`,
    }
  }

  get path(): string {
    return this._path
  }

  private async _open(): Promise<void> {
    if (this.parent) {
      // if the parent folder is provided, the folder path is relative to the parent folder
      this._path = join(this.parent.path, this.entity.meta.name)
    } else {
      // otherwise, the folder path is in a temporary directory
      // use HIGHSTATE_TEMP_PATH as base if available for better cleanup reliability
      const tempBase = process.env.HIGHSTATE_TEMP_PATH || tmpdir()
      this._tmpPath = await mkdtemp(join(tempBase, "highstate-folder-"))
      this._path = join(this._tmpPath, this.entity.meta.name)
    }

    switch (this.entity.content.type) {
      case "embedded": {
        // create the folder itself
        await mkdir(this._path, { mode: this.entity.meta.mode })

        for (const file of this.entity.content.files) {
          const materializedFile = await MaterializedFile.open(file, this)
          this._disposables.push(materializedFile)
        }

        for (const subfolder of this.entity.content.folders) {
          const materializedFolder = await MaterializedFolder.open(subfolder, this)
          this._disposables.push(materializedFolder)
        }

        break
      }
      case "local": {
        // Check if the local path is an archive file that needs extraction
        const archiveType = detectArchiveType(this.entity.content.path)

        if (archiveType) {
          // Extract archive to the destination path
          const readStream = createReadStream(this.entity.content.path)
          await unarchiveFromStream(readStream, this._path, archiveType)
        } else {
          // Regular directory copy
          await cp(this.entity.content.path, this._path, {
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

        await unarchiveFromStream(stream, this._path, archiveType)

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
        await unarchiveFromStream(readStream, dirname(this._path), "tar")

        break
      }
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this._disposed) return
    this._disposed = true

    try {
      if (this._tmpPath) {
        // clear the whole temporary directory if it was created
        await rm(this._tmpPath, { recursive: true, force: true })
      } else {
        // otherwise, just remove the folder
        await rm(this._path, { recursive: true, force: true })
      }
    } catch (error) {
      // ignore errors during cleanup, as the folder might have been already removed
      // or the temporary directory might not exist
      // TODO: centralized logging for unit code
      console.warn("failed to clean up materialized folder:", error)
    }

    // dispose all materialized children
    for (const disposable of this._disposables) {
      await disposable[Symbol.asyncDispose]()
    }
  }

  /**
   * Packs the materialized folder into an artifact and returns the folder entity with artifact content.
   *
   * Creates a tgz archive of the entire folder and stores it in HIGHSTATE_ARTIFACT_WRITE_PATH where it will be collected by Highstate.
   */
  async pack({ include, exclude }: FolderPackOptions = {}): Promise<common.ArtifactFolder> {
    const writeDir = process.env.HIGHSTATE_ARTIFACT_WRITE_PATH
    if (!writeDir) {
      throw new Error("HIGHSTATE_ARTIFACT_WRITE_PATH environment variable is not set")
    }

    // read actual folder stats from filesystem
    const folderStats = await stat(this._path)

    // create tgz archive of the folder
    const tempBase = process.env.HIGHSTATE_TEMP_PATH || tmpdir()
    const tempArchivePath = join(tempBase, `highstate-pack-${Date.now()}.tgz`)

    const entity = this.entity

    try {
      await tar.create(
        {
          gzip: true,
          file: tempArchivePath,
          cwd: dirname(this._path),

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
        [basename(this._path)],
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
      return {
        meta: newMeta,
        content: {
          [HighstateSignature.Artifact]: true,
          type: "artifact",
          hash: hashValue,
          meta: await toPromise(this.artifactMeta),
        },
      }
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
   * Creates an empty materialized folder with the given name.
   *
   * @param name The name of the folder to create
   * @param mode Optional folder mode (permissions)
   * @param parent Optional parent folder to create the folder in
   * @returns A new MaterializedFolder instance representing an empty folder
   */
  static async create(
    name: string,
    mode?: number,
    parent?: MaterializedFolder,
  ): Promise<MaterializedFolder> {
    const entity: common.Folder = {
      meta: {
        name,
        mode,
      },
      content: {
        type: "embedded",
        files: [],
        folders: [],
      },
    }

    const materializedFolder = new MaterializedFolder(entity, parent)

    try {
      await materializedFolder._open()
    } catch (error) {
      await materializedFolder[Symbol.asyncDispose]()
      throw error
    }

    return materializedFolder
  }

  static async open(
    folder: common.Folder,
    parent?: MaterializedFolder,
  ): Promise<MaterializedFolder> {
    const materializedFolder = new MaterializedFolder(folder, parent)

    try {
      await materializedFolder._open()
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
  const parsedEndpoint = parseL7Endpoint(endpoint)

  return parsedEndpoint.path ? basename(parsedEndpoint.path) : ""
}
