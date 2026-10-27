import type {
  RunnerBackend,
  UnitDestroyOptions,
  UnitOptions,
  UnitStateOptions,
  UnitStateUpdate,
  UnitUpdateOptions,
} from "./abstractions"

/** Defers host tooling initialization until a legacy or local-overlay action actually needs it. */
export class LazyRunnerBackend implements RunnerBackend, AsyncDisposable {
  private backend: Promise<RunnerBackend> | undefined

  constructor(private readonly create: () => Promise<RunnerBackend>) {}

  private async get(): Promise<RunnerBackend> {
    this.backend ??= this.create().catch(error => {
      this.backend = undefined
      throw error
    })
    return await this.backend
  }

  async *watch(options: UnitOptions): AsyncIterable<UnitStateUpdate> {
    yield* (await this.get()).watch(options)
  }

  async update(options: UnitUpdateOptions): Promise<void> {
    await (await this.get()).update(options)
  }
  async preview(options: UnitUpdateOptions): Promise<void> {
    await (await this.get()).preview(options)
  }
  async destroy(options: UnitDestroyOptions): Promise<void> {
    await (await this.get()).destroy(options)
  }
  async refresh(options: UnitOptions): Promise<void> {
    await (await this.get()).refresh(options)
  }
  async deleteState(options: UnitStateOptions): Promise<void> {
    await (await this.get()).deleteState(options)
  }

  async finishOperation(projectId: string, operationId: string): Promise<void> {
    if (this.backend) await (await this.backend).finishOperation?.(projectId, operationId)
  }

  async [Symbol.asyncDispose](): Promise<void> {
    const backend = await this.backend
    if (!backend) return
    if (Symbol.asyncDispose in backend)
      await (backend as RunnerBackend & AsyncDisposable)[Symbol.asyncDispose]()
    else if (Symbol.dispose in backend) (backend as RunnerBackend & Disposable)[Symbol.dispose]()
  }
}
