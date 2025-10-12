import type { InstanceId, InstanceModel } from "@highstate/contract"
import type { LibraryModel, LibraryUpdate, ResolvedInstanceInput } from "../shared"

export type ResolvedUnitSource = {
  unitType: string
  sourceHash: number
  projectPath: string
  allowedDependencies: string[]
}

export type ProjectEvaluationResult =
  | {
      success: true
      virtualInstances: InstanceModel[]

      /**
       * The mapping of top-level composite instance IDs to error messages if any.
       */
      topLevelErrors: Record<InstanceId, string>
    }
  | {
      success: false
      error: string
    }

export interface LibraryBackend {
  /**
   * Loads the library.
   */
  loadLibrary(libraryId: string | undefined, signal?: AbortSignal): Promise<LibraryModel>

  /**
   * Watches the library for changes.
   */
  watchLibrary(libraryId: string | undefined, signal?: AbortSignal): AsyncIterable<LibraryUpdate[]>

  /**
   * Gets the resolved unit sources for the given unit types.
   *
   * If the packages for these units are not resolved, it will resolve them and include in watch list.
   */
  getResolvedUnitSources(
    libraryId: string | undefined,
    unitTypes: string[],
  ): Promise<ResolvedUnitSource[]>

  /**
   * Watches the resolved unit sources for changes.
   * Returns an async iterable that emits each resolved unit source whenever it changes.
   * Does not emit the resolved unit sources for units that have not changed even if the library was reloaded.
   *
   * @param libraryId The library ID to watch for resolved unit sources.
   * @param signal Optional AbortSignal to cancel the watch.
   */
  watchResolvedUnitSources(
    libraryId: string | undefined,
    signal?: AbortSignal,
  ): AsyncIterable<ResolvedUnitSource>

  /**
   * Evaluates the composite instances of the project and returns evaluated virtual instances.
   *
   * @param libraryId The library ID to use for evaluation.
   * @param allInstances The all instances of the project.
   * @param resolvedInputs The resolved inputs of the instances.
   */
  evaluateCompositeInstances(
    libraryId: string | undefined,
    allInstances: InstanceModel[],
    resolvedInputs: Record<string, Record<string, ResolvedInstanceInput[]>>,
  ): Promise<ProjectEvaluationResult>
}
