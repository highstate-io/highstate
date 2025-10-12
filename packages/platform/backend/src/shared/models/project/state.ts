import type { InstanceId } from "@highstate/contract"
import type {
  InstanceState as DatabaseInstanceState,
  InstanceCustomStatus,
  InstanceEvaluationState,
  InstanceOperationState,
  InstanceOperationStatus,
} from "../../../database"
import { z } from "zod"

export const stableInstanceInputSchema = z.object({
  stateId: z.string(),
  output: z.string(),
})

/**
 * The instance input that references state IDs instead of instance IDs.
 *
 * This provides a stable reference to an instance output that is not affected by instance ID changes.
 */
export type StableInstanceInput = z.infer<typeof stableInstanceInputSchema>

/**
 * The instance state aggregate including all related states.
 */
export type InstanceState = DatabaseInstanceState & {
  /**
   * The ID of the parent instance, if any.
   *
   * Not to be confused with `parentId` which is the surrogate ID of the parent state.
   */
  parentInstanceId?: InstanceId | null

  /**
   * The names of the instance secrets which have values set.
   */
  secretNames?: string[]

  /**
   * The last operation state of the instance.
   */
  lastOperationState?: InstanceOperationState | null

  /**
   * The evaluation state of the instance.
   */
  evaluationState?: InstanceEvaluationState | null

  /**
   * The IDs of the terminals produced by this unit instance.
   */
  terminalIds?: string[]

  /**
   * The IDs of the pages produced by this unit instance.
   */
  pageIds?: string[]

  /**
   * The IDs of the triggers produced by this unit instance.
   */
  triggerIds?: string[]

  /**
   * The custom statuses attached to this instance.
   */
  customStatuses?: InstanceCustomStatus[]
}

export const instanceStateEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("updated"),
    state: z.custom<InstanceState>(),
  }),
  z.object({
    type: z.literal("patched"),
    stateId: z.string(),
    patch: z.custom<Partial<InstanceState>>(),
  }),
  z.object({
    type: z.literal("deleted"),
    stateId: z.string(),
  }),
])

/**
 * Checks if the given instance state represents a "virtual ghost" instance.
 *
 * Note: The evaluation state must be loaded, otherwise this function will always return true.
 *
 * @param state The instance state to check.
 * @returns True if the instance is a virtual ghost, false otherwise.
 */
export function isVirtualGhostInstance(
  state: Pick<InstanceState, "status" | "source" | "evaluationState">,
): boolean {
  if (state.source !== "virtual") return false
  if (state.status === "undeployed") return false

  return !state.evaluationState
}

/**
 * Checks if the given instance state represents a deployed instance.
 *
 * An instance is considered deployed if the state exists and its status is not "undeployed".
 *
 * @param state The instance state to check (can be undefined).
 * @returns True if the instance is deployed, false otherwise.
 */
export function isInstanceDeployed(state: InstanceState | undefined): boolean {
  return !!state && state.status !== "undeployed"
}

export type {
  InstanceEvaluationState,
  InstanceEvaluationStatus,
  InstanceOperationState,
  InstanceOperationStatus,
  InstanceStatus,
} from "../../../database"

export const finalInstanceOperationStatuses: InstanceOperationStatus[] = [
  "previewed",
  "destroyed",
  "updated",
  "cancelled",
  "destroyed",
  "failed",
  "skipped",
]

/**
 * Checks if an instance operation status exists and is final transient (not stable).
 *
 * @param status The instance operation status to check
 * @returns True if the status is transient
 */
export function isTransientInstanceOperationStatus(status?: InstanceOperationStatus): boolean {
  return !!status && !finalInstanceOperationStatuses.includes(status)
}

export const workerUnitRegistrationEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("registered"),
    instanceId: z.string(),
    params: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("deregistered"),
    instanceId: z.string(),
  }),
])

export type WorkerUnitRegistrationEvent = z.infer<typeof workerUnitRegistrationEventSchema>
