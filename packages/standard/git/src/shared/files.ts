import type { CommonObjectMeta } from "@highstate/contract"
import type { common } from "@highstate/library"
import { randomUUID } from "node:crypto"
import { glob, readFile, stat } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import {
  type FolderPackOptions,
  getNameByEndpoint,
  type InputL7Endpoint,
  l7EndpointToString,
  type MaterializationAction,
  MaterializedFolder,
  parseEndpoint,
} from "@highstate/common"
import { common as entities } from "@highstate/library"
import { getCombinedIdentity, makeEntity } from "@highstate/pulumi"
import { type SimpleGit, simpleGit } from "simple-git"

export type RepositoryPackOptions = FolderPackOptions & {
  /**
   * Whether the .git directory should be included in the packed artifact.
   *
   * If true, all the history will be included and all git operations will be available,
   * but the artifact will be larger and will not be reproducible since some files inside .git
   * contain timestamps.
   *
   * If false, the .git directory will not be included in the packed artifact,
   * making the artifact smaller and reproducible, but git operations will be
   * executed on empty repository with no history.
   *
   * By default, this is false.
   */
  includeGit?: boolean

  /**
   * Whether to include ignored files specified in .gitignore in the packed artifact.
   *
   * By default, this is false.
   */
  includeIgnored?: boolean
}

/**
 * The `MaterializedRepository` class represents a git repository entity that has been materialized
 * to a local filesystem path.
 *
 * It embeds MaterializedFolder and adds git-specific operations like cloning, initializing,
 * and checking out branches.
 */
export class MaterializedRepository implements AsyncDisposable {
  private _path?: string
  private readonly _folder: MaterializedFolder
  private _git?: SimpleGit
  private _rootRef?: AsyncDisposable

  constructor(
    readonly entity: common.Folder,
    private readonly parent?: MaterializedRepository | MaterializedFolder,
  ) {
    const { folder, isCloneSource } = this._materializeFolder()
    this._folder = folder
    this._path = folder.path

    folder.onMaterialized(async () => {
      if (isCloneSource) {
        await this._cloneRepository()

        const remoteContent = this.entity.content
        if (remoteContent.type === "remote") {
          this.artifactMeta.description = `Cloned from "${l7EndpointToString(remoteContent.endpoint)}".`
        }
      } else {
        await this._initializeGitIfNeeded()
      }

      this.artifactMeta.title = "Git Repository"
      this.artifactMeta.icon = "simple-icons:git"
      this.artifactMeta.iconColor = "#f1502f"

      this._git = simpleGit(this.path)

      await this.git.addConfig("user.name", "Highstate")
      await this.git.addConfig("user.email", "highstate@highstate.io")
    })
  }

  get path(): string {
    if (!this._path) {
      throw new Error("MaterializedRepository is not opened")
    }

    return this._path
  }

  get git(): SimpleGit {
    if (!this._git) {
      throw new Error("MaterializedRepository is not opened")
    }

    return this._git
  }

  get folder(): MaterializedFolder {
    return this._folder
  }

  get artifactMeta(): CommonObjectMeta {
    return this.folder.artifactMeta
  }

  /**
   * Determines if a remote path should be handled as a git repository.
   * Returns true if path ends with .git or has no extension.
   */
  private _shouldCloneAsGitRepo(remotePath: string): boolean {
    return remotePath.endsWith(".git") || !extname(remotePath)
  }

  private getParent(): MaterializedFolder | undefined {
    if (this.parent instanceof MaterializedRepository) {
      return this.parent.folder
    }

    return this.parent
  }

  /**
   * Opens the materialized repository and returns a reference that keeps it open.
   */
  async open(): Promise<AsyncDisposable> {
    return await this.folder.open()
  }

  /**
   * Sets the action to be performed when the repository is materialized.
   */
  onMaterialized(action: MaterializationAction): void {
    this.folder.onMaterialized(action)
  }

  private _materializeFolder(): { folder: MaterializedFolder; isCloneSource: boolean } {
    const parent = this.getParent()
    const folderContent = this.entity.content
    const isCloneSource =
      folderContent.type === "remote" &&
      this._shouldCloneAsGitRepo(l7EndpointToString(folderContent.endpoint))

    const folderEntity = isCloneSource ? this._makeEmptyFolderEntity() : this.entity

    if (!parent) {
      return {
        folder: MaterializedFolder.for(
          folderEntity,
          `git-repository-${this.entity.$meta.identity}`,
        ),
        isCloneSource,
      }
    }

    return {
      // @ts-expect-error bypass constructor visibility for nested folder materialization
      folder: new MaterializedFolder(folderEntity, undefined, parent),
      isCloneSource,
    }
  }

  private _makeEmptyFolderEntity(): common.Folder {
    return makeEntity({
      entity: entities.folderEntity,
      identity: `${this.entity.$meta.identity}:materialized-repository:${randomUUID()}`,
      meta: {
        title: this.entity.meta.name,
      },
      value: {
        meta: {
          name: this.entity.meta.name,
          mode: this.entity.meta.mode,
        },
        content: {
          type: "embedded",
        },
      },
    })
  }

  /**
   * Clones a remote git repository.
   */
  private async _cloneRepository(): Promise<void> {
    const folderContent = this.entity.content
    if (folderContent.type !== "remote") {
      throw new Error("Expected remote folder content for cloning")
    }

    const url = l7EndpointToString(folderContent.endpoint)

    try {
      const git = simpleGit()
      await git.clone(url, this.path)
    } catch (error) {
      throw new Error(
        `Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Initializes a git repository if the directory is not already a git repository.
   */
  private async _initializeGitIfNeeded(): Promise<void> {
    const gitDir = join(this.folder.path, ".git")

    try {
      await stat(gitDir)
      // .git directory exists, assume it's already a git repository
      return
    } catch {
      // .git directory doesn't exist, initialize the repository
    }

    try {
      const git = simpleGit(this.folder.path)
      await git.init()
    } catch (error) {
      throw new Error(
        `Failed to initialize git repository: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    try {
      if (this._rootRef) {
        await this._rootRef[Symbol.asyncDispose]()
        this._rootRef = undefined
      }

      this._git = undefined
    } catch (error) {
      // ignore errors during cleanup
      console.warn("failed to clean up materialized repository:", error)
    }
  }

  /**
   * Packs the materialized repository into an artifact and returns the repository entity with artifact content.
   */
  async pack({
    include,
    exclude,
    includeGit,
    includeIgnored,
  }: RepositoryPackOptions = {}): Promise<common.ArtifactFolder> {
    await using _ = await this.open()

    const excludePatterns = [...(exclude ?? []), ...(includeGit ? [] : [".git"])]

    if (!includeIgnored) {
      const gitIgnorePatterns = await this.getGitIgnorePatterns()
      excludePatterns.push(...gitIgnorePatterns)
    }

    return await this.folder.pack({
      include,
      exclude: excludePatterns,
    })
  }

  private async getGitIgnorePatterns(): Promise<string[]> {
    const result: string[] = []
    const gitIgnoreFiles = glob(".gitignore", { cwd: this.folder.path })

    for await (const file of gitIgnoreFiles) {
      const filePath = join(this.folder.path, file)
      try {
        const relativePrefix = dirname(file)

        const content = await readFile(filePath, "utf-8")
        const patterns = content
          .split("\n")
          .map(line => line.trim())
          // remove empty lines and comments
          .filter(line => line && !line.startsWith("#"))
          // append relative prefix to patterns
          .map(pattern => {
            if (relativePrefix === ".") {
              return pattern
            }

            return join(relativePrefix, pattern)
          })

        result.push(...patterns)
      } catch (error) {
        console.warn(`Failed to read .gitignore file at ${filePath}:`, error)
      }
    }

    return result
  }

  /**
   * Clones a remote git repository into a new materialized repository.
   *
   * @param endpoint The L7 endpoint of the remote repository to clone
   * @param name The optional name for the new repository
   * @param mode Optional directory mode (permissions)
   */
  static async clone(
    endpoint: InputL7Endpoint,
    name?: string,
    mode?: number,
  ): Promise<MaterializedRepository> {
    const parsedEndpoint = parseEndpoint(endpoint, 7)

    const entity = makeEntity({
      entity: entities.folderEntity,
      identity: getCombinedIdentity(["git", endpoint]),
      meta: {
        title: name ?? getNameByEndpoint(parsedEndpoint),
      },
      value: {
        meta: {
          name: name ?? getNameByEndpoint(parsedEndpoint),
          mode,
        },
        content: {
          type: "remote",
          endpoint: parsedEndpoint,
        },
      },
    })

    const materializedRepo = new MaterializedRepository(entity)

    try {
      materializedRepo._rootRef = await materializedRepo.open()
    } catch (error) {
      await materializedRepo[Symbol.asyncDispose]()
      throw error
    }

    return materializedRepo
  }

  /**
   * Creates an empty materialized repository with the given name.
   *
   * @param name The name of the repository to create
   * @param mode Optional directory mode (permissions)
   * @returns A new MaterializedRepository instance representing an empty repository
   */
  static async create(name: string, mode?: number): Promise<MaterializedRepository> {
    const entity = makeEntity({
      entity: entities.folderEntity,
      identity: getCombinedIdentity(["git", "empty", name]),
      meta: {
        title: name,
      },
      value: {
        meta: {
          name,
          mode,
        },
        content: {
          type: "embedded",
        },
      },
    })

    const materializedRepo = new MaterializedRepository(entity)

    try {
      materializedRepo._rootRef = await materializedRepo.open()
    } catch (error) {
      await materializedRepo[Symbol.asyncDispose]()
      throw error
    }

    return materializedRepo
  }

  /**
   * Opens a git repository entity and materializes it to the filesystem.
   *
   * @param repository The repository entity to materialize
   * @returns A new MaterializedRepository instance
   */
  // biome-ignore lint/suspicious/useAdjacentOverloadSignatures: class intentionally provides both instance and static open APIs
  static async open(
    repository: common.Folder,
    parent?: MaterializedRepository | MaterializedFolder,
  ): Promise<MaterializedRepository> {
    const materializedRepo = new MaterializedRepository(repository, parent)

    try {
      materializedRepo._rootRef = await materializedRepo.open()
    } catch (error) {
      await materializedRepo[Symbol.asyncDispose]()
      throw error
    }

    return materializedRepo
  }
}
