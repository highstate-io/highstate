import type {
  GenericName,
  InstanceId,
  InstanceStatusField,
  UnitConfig,
  UnitPage,
  UnitTerminal,
  UnitTrigger,
  UnitWorker,
  VersionedName,
} from "@highstate/contract"
import type { Artifact } from "../database"

export type OperationType = "update" | "destroy" | "refresh"

export type UnitStateUpdate = {
  /**
   * The id of the unit that produced this update.
   */
  unitId: InstanceId
} & (
  | {
      type: "progress"

      /**
       * The current count of Pulumi resources being processed.
       */
      currentResourceCount?: number

      /**
       * The total count of Pulumi resources being processed.
       */
      totalResourceCount?: number
    }
  | {
      type: "error"

      /**
       * The error message produced by the unit.
       */
      message: string
    }
  | {
      type: "message"

      /**
       * The message produced by the unit.
       */
      message: string
    }
  | {
      type: "completion"

      /**
       * The type of the operation that was performed by the unit.
       */
      operationType: OperationType

      /**
       * The CRC32 hash of the output produced by the unit.
       */
      outputHash?: number | null

      /**
       * The status fields produced by the unit.
       */
      statusFields?: InstanceStatusField[] | null

      /**
       * The terminals produced by the unit.
       */
      terminals?: UnitTerminal[] | null

      /**
       * The pages produced by the unit.
       */
      pages?: UnitPage[] | null

      /**
       * The triggers produced by the unit.
       */
      triggers?: UnitTrigger[] | null

      /**
       * The values of the secrets produced by the unit.
       */
      secrets?: Record<string, unknown> | null

      /**
       * The workers produced by the unit.
       */
      workers?: UnitWorker[] | null

      /**
       * The IDs of the artifacts exported by the unit.
       *
       * The keys are the output names, and the values are the IDs of the artifacts exported for that output.
       */
      exportedArtifactIds?: Record<string, string[]> | null
    }
)

export type TypedUnitStateUpdate<T extends UnitStateUpdate["type"]> = UnitStateUpdate & { type: T }

export type UnitOptions = {
  /**
   * The project ID containing the instance.
   */
  projectId: string

  /**
   * The state ID to use as the stack name.
   */
  stateId: string

  /**
   * The library ID containing the unit definitions.
   */
  libraryId: string

  /**
   * The type of the instance to run.
   */
  instanceType: VersionedName

  /**
   * The name of the instance to run.
   */
  instanceName: GenericName

  /**
   * The signal to abort the operation.
   */
  signal?: AbortSignal

  /**
   * The signal to force abort the operation.
   */
  forceSignal?: AbortSignal

  /**
   * Enable debug logging for Pulumi engine and resource providers.
   *
   * May expose sensitive information including credentials in the logs.
   */
  debug?: boolean
}

export type UnitUpdateOptions = UnitOptions & {
  /**
   * The configuration to pass to the unit.
   */
  config: UnitConfig

  /**
   * The secret values to pass to the unit.
   */
  secrets: Record<string, unknown>

  /**
   * Artifact required by this instance.
   */
  artifacts?: Artifact[]

  /**
   * Additional environment variables to pass to the unit.
   */
  envVars?: Record<string, string>

  /**
   * Whether to refresh the state before updating.
   */
  refresh?: boolean

  /**
   * Whether to delete the unreachable resources (e.g. k8s resources in unreachable clusters).
   */
  deleteUnreachable?: boolean
}

export type UnitDestroyOptions = UnitOptions & {
  /**
   * Whether to refresh the state before updating.
   */
  refresh?: boolean

  /**
   * Whether to delete the unreachable resources (e.g. k8s resources in unreachable clusters).
   */
  deleteUnreachable?: boolean

  /**
   * Delete the stack state even if the destroy operation fails.
   */
  forceDeleteState?: boolean
}

export interface RunnerBackend {
  /**
   * Watches the instance state and emits state updates.
   *
   * Must ensure the relible delivery of the updates,
   * even if the connection is closed and re-established.
   *
   * Should handle reconnection and resume watching transparently.
   */
  watch(options: UnitOptions): AsyncIterable<UnitStateUpdate>

  /**
   * Updates the instance.
   *
   * The operation must only be aborted by the signal, not even when the connection is closed.
   * If the instance is already updating, it should exit immediately.
   */
  update(options: UnitUpdateOptions): Promise<void>

  /**
   * Previews the instance update without actually applying the changes.
   *
   * The operation must only be aborted explictily by the signal, not even when the connection is closed.
   */
  preview(options: UnitUpdateOptions): Promise<void>

  /**
   * Destroys the instance.
   *
   * The operation must only be aborted explictily by the signal, not even when the connection is closed.
   */
  destroy(options: UnitDestroyOptions): Promise<void>

  /**
   * Refreshes the instance.
   *
   * The operation must only be aborted explictily by the signal, not even when the connection is closed.
   */
  refresh(options: UnitOptions): Promise<void>

  /**
   * Force deletes the instance state.
   *
   * Should throw an error if state cannot be deleted.
   */
  deleteState(options: UnitOptions): Promise<void>
}
