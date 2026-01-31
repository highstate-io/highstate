import type { CommonObjectMeta } from "@highstate/contract"
import type { common } from "@highstate/library"
import { glob, readFile, stat } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import {
  type FolderPackOptions,
  getNameByEndpoint,
  type InputL7Endpoint,
  l7EndpointToString,
  MaterializedFolder,
  parseEndpoint,
} from "@highstate/common"
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
  private _path!: string
  private _folder!: MaterializedFolder
  private _git!: SimpleGit

  constructor(
    readonly entity: common.Folder,
    private readonly parent?: MaterializedRepository | MaterializedFolder,
  ) {}

  get path(): string {
    return this._path
  }

  get git(): SimpleGit {
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
   * Opens the repository by handling different content types and git-specific operations.
   */
  private async _open(): Promise<void> {
    const folderContent = this.entity.content

    switch (folderContent.type) {
      case "embedded": {
        // for embedded content, use MaterializedFolder to handle the files
        this._folder = await MaterializedFolder.open(this.entity, this.getParent())
        this._path = this._folder.path

        // initialize git repository if it's not already one
        await this._initializeGitIfNeeded()
        break
      }
      case "local": {
        // for local content, first materialize the folder then handle git operations
        this._folder = await MaterializedFolder.open(this.entity, this.getParent())
        this._path = this._folder.path

        // check if it's already a git repository, if not initialize it
        await this._initializeGitIfNeeded()
        break
      }
      case "remote": {
        const url = l7EndpointToString(folderContent.endpoint)

        // check if remote path should be cloned as git repo
        if (this._shouldCloneAsGitRepo(url)) {
          // create empty folder and materialize it for cloning
          this._folder = await MaterializedFolder.create(
            this.entity.meta.name,
            undefined,
            this.getParent(),
          )

          this.artifactMeta.description = `Cloned from "${url}".`

          this._path = this._folder.path
          await this._cloneRepository()
        } else {
          // use MaterializedFolder for non-git remote content
          this._folder = await MaterializedFolder.open(this.entity, this.getParent())
          this._path = this._folder.path
          await this._initializeGitIfNeeded()
        }
        break
      }
      case "artifact": {
        // for artifact content, use MaterializedFolder to extract and then handle git operations
        this._folder = await MaterializedFolder.open(this.entity, this.getParent())
        this._path = this._folder.path

        // initialize git repository if needed
        await this._initializeGitIfNeeded()
        break
      }
    }

    // set artifact metadata
    this.artifactMeta.title = "Git Repository"
    this.artifactMeta.icon = "simple-icons:git"
    this.artifactMeta.iconColor = "#f1502f"

    // initialize git instance
    this._git = simpleGit(this._path)

    // set up user
    await this.git.addConfig("user.name", "Highstate")
    await this.git.addConfig("user.email", "highstate@highstate.io")
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
      await git.clone(url, this._path)
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
    const gitDir = join(this._folder.path, ".git")

    try {
      await stat(gitDir)
      // .git directory exists, assume it's already a git repository
      return
    } catch {
      // .git directory doesn't exist, initialize the repository
    }

    try {
      const git = simpleGit(this._folder.path)
      await git.init()
    } catch (error) {
      throw new Error(
        `Failed to initialize git repository: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    try {
      // dispose the embedded folder
      await this._folder[Symbol.asyncDispose]()
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
    const excludePatterns = [...(exclude ?? []), ...(includeGit ? [] : [".git"])]

    if (!includeIgnored) {
      const gitIgnorePatterns = await this.getGitIgnorePatterns()
      excludePatterns.push(...gitIgnorePatterns)
    }

    return await this._folder.pack({
      include,
      exclude: excludePatterns,
    })
  }

  private async getGitIgnorePatterns(): Promise<string[]> {
    const result: string[] = []
    const gitIgnoreFiles = glob(".gitignore", { cwd: this._folder.path })

    for await (const file of gitIgnoreFiles) {
      const filePath = join(this._folder.path, file)
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

    const entity: common.Folder = {
      meta: {
        name: name ?? getNameByEndpoint(parsedEndpoint),
        mode,
      },
      content: {
        type: "remote",
        endpoint: parsedEndpoint,
      },
    }

    const materializedRepo = new MaterializedRepository(entity)

    try {
      await materializedRepo._open()
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

    const materializedRepo = new MaterializedRepository(entity)

    try {
      await materializedRepo._open()
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
  static async open(
    repository: common.Folder,
    parent?: MaterializedRepository | MaterializedFolder,
  ): Promise<MaterializedRepository> {
    const materializedRepo = new MaterializedRepository(repository, parent)

    try {
      await materializedRepo._open()
    } catch (error) {
      await materializedRepo[Symbol.asyncDispose]()
      throw error
    }

    return materializedRepo
  }
}
