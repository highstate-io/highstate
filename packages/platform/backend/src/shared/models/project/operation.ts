import type { Operation, OperationStatus, OperationType } from "../../../database"
import { instanceIdSchema, objectMetaSchema, z } from "@highstate/contract"

/**
 * Phase type for operation execution.
 */
export const operationPhaseTypeSchema = z.enum(["destroy", "preview", "update", "refresh"])

/**
 * Instance information for operation phase.
 */
export const operationPhaseInstanceSchema = z.object({
  /**
   * The ID of the instance.
   */
  id: instanceIdSchema,

  /**
   * The parent ID of the instance, either from the model or the state.
   */
  parentId: z.string().optional(),

  /**
   * Human-readable explanation of the decision.
   * */
  message: z.string(),
})

/**
 * Single phase of operation execution.
 */
export const operationPhaseSchema = z.object({
  /**
   * Type of phase being executed.
   */
  type: operationPhaseTypeSchema,

  /**
   * List of instances to be processed in this phase.
   */
  instances: z.array(operationPhaseInstanceSchema),
})

export type OperationPhase = z.infer<typeof operationPhaseSchema>
export type OperationPhaseType = z.infer<typeof operationPhaseTypeSchema>
export type OperationPhaseInstance = z.infer<typeof operationPhaseInstanceSchema>

export const operationOptionsSchema = z
  .object({
    /**
     * Force update all dependencies regardless of their current state.
     *
     * **Operation Behavior Impact:**
     * - bypasses hash-based change detection for dependency chains;
     * - includes **ALL** dependencies (up-to-date, out-of-date, and error states);
     * - traverses the entire dependency graph from requested instances.
     *
     * **Usage with other options:**
     * - combined with `forceUpdateChildren`: updates entire dependency tree **AND** all composite children;
     * - independent of `allowPartialCompositeInstanceCreation`: affects dependency traversal, not composite logic.
     */
    forceUpdateDependencies: z.boolean().default(false),

    /**
     * Ignore dependencies and operate only on explicitly requested instances.
     *
     * **Operation Behavior Impact:**
     * - skips dependency inclusion even when dependencies are failed or undeployed;
     * - caller must explicitly include every prerequisite instance to avoid failures;
     * - complements on-demand or targeted updates where dependency safety is managed externally.
     *
     * **Usage with other options:**
     * - mutually exclusive with `forceUpdateDependencies`;
     * - independent of child/composite inclusion options.
     */
    ignoreDependencies: z.boolean().default(false),

    /**
     * Force update all children of composite instances regardless of their state.
     *
     * **Operation Behavior Impact:**
     * - overrides selective child inclusion logic for composites;
     * - includes **ALL** children of affected composites (up-to-date, out-of-date, and error states);
     * - applied after dependency traversal and parent inclusion.
     *
     * **Usage with other options:**
     * - combined with `forceUpdateDependencies`: creates comprehensive force-update behavior;
     * - overrides `allowPartialCompositeInstanceCreation`: when enabled, **ALL** children are included regardless of existence.
     */
    forceUpdateChildren: z.boolean().default(false),

    /**
     * Include dependent instances when destroying instances.
     *
     * **Operation Behavior Impact:**
     * - extends destroy operations to include instances that depend on the target;
     * - traverses the dependency graph in reverse (dependents, not dependencies);
     * - prevents orphaned instances that would fail without their dependencies.
     *
     * **Usage with other options:**
     * - works with `invokeDestroyTriggers`: ensures triggers run for all dependents;
     * - independent of update-related options.
     */
    destroyDependentInstances: z.boolean().default(true),

    /**
     * Execute destroy triggers when destroying instances.
     *
     * **Operation Behavior Impact:**
     * - affects how individual units are destroyed (triggers vs direct deletion);
     * - does not change which instances are selected for destruction;
     * - controls trigger execution during the destruction phase.
     *
     * **Usage with other options:**
     * - used with `destroyDependentInstances`: ensures triggers run for cascade deletions;
     * - independent of update-related options.
     */
    invokeDestroyTriggers: z.boolean().default(true),

    /**
     * Delete Pulumi resources that are no longer referenced in the state.
     *
     * **Operation Behavior Impact:**
     * - does not affect which instances are selected for operations;
     * - deletes orphaned Pulumi resources within individual instances.
     *
     * **Usage with other options:**
     * - independent of instance selection options;
     * - complements destroy-related options for thorough cleanup.
     */
    deleteUnreachableResources: z.boolean().default(false),

    /**
     * Force deletion of instance state even if the destroy operation fails.
     *
     * **Operation Behavior Impact:**
     * - forces state deletion even when destroy operations fail;
     * - does not affect which instances are selected for operations;
     * - bypasses normal destroy procedures as emergency fallback.
     *
     * **Usage with other options:**
     * - used with destroy-related options when normal cleanup fails;
     * - should be used cautiously as it can create state inconsistencies.
     */
    forceDeleteState: z.boolean().default(false),

    /**
     * Allow partial update of composite instances without requiring all outdated children.
     *
     * **Operation Behavior Impact:**
     * - controls whether composite operations must include all outdated children or only necessary ones;
     * - when `false` (default): all outdated children of substantive composites are included in operations;
     * - when `true`: only necessary children are included, allowing partial composite operations;
     * - applied during composite child traversal phase for substantive composites only.
     *
     * **Usage with other options:**
     * - overridden by `forceUpdateChildren`: when force is enabled, **ALL** children are included regardless;
     * - independent of `forceUpdateDependencies`: affects composite logic, not dependency traversal.
     */
    allowPartialCompositeInstanceUpdate: z.boolean().default(false),

    /**
     * Allow partial destruction of composite instances during cascade operations.
     *
     * **Operation Behavior Impact:**
     * - controls whether cascade destruction must include all children or only necessary ones;
     * - when `false` (default): cascade destruction includes **ALL** children of affected composites;
     * - when `true`: cascade destruction includes only directly dependent children;
     * - does not affect explicit composite destruction (always destroys all children);
     * - does not affect parent propagation when destroying sibling composites.
     *
     * **Usage with other options:**
     * - works with `destroyDependentInstances`: controls completeness of cascade destruction;
     * - independent of update-related options.
     */
    allowPartialCompositeInstanceDestruction: z.boolean().default(false),

    /**
     * Also refresh the state of instances during the operation.
     *
     * **Operation Behavior Impact:**
     * - does not change which instances are selected for operations;
     * - synchronizes state with actual infrastructure during the operation.
     *
     * **Usage with other options:**
     * - additive with dependency resolution options: refreshes all selected instances;
     * - works with both all operation types.
     */
    refresh: z.boolean().default(false),

    /**
     * Enable debug logging for Pulumi engine and resource providers.
     *
     * **Security Note:**
     * Debug mode may expose sensitive information including credentials in the logs.
     * Use only when absolutely necessary for troubleshooting.
     *
     * **Implementation:**
     * - sets Pulumi's debug option to true;
     * - sets TF_LOG=DEBUG environment variable for Terraform providers.
     */
    debug: z.boolean().default(false),
  })
  .partial()

export const operationTypeSchema = z.enum([
  "update",
  "preview",
  "destroy",
  "recreate",
  "refresh",
]) satisfies z.ZodType<OperationType>

export const operationStatusSchema = z.enum([
  "pending",
  "running",
  "failing",
  "completed",
  "failed",
  "cancelled",
]) satisfies z.ZodType<OperationStatus>

export const operationMetaSchema = objectMetaSchema
  .pick({
    title: true,
    description: true,
  })
  .required({ title: true })

export const operationPlanInputSchema = z.object({
  projectId: z.string(),
  type: operationTypeSchema,
  instanceIds: z.array(instanceIdSchema).min(1),
  options: operationOptionsSchema.partial().optional(),
})

export const operationLaunchInputSchema = operationPlanInputSchema.extend({
  meta: operationMetaSchema,
  plan: operationPhaseSchema.array().optional(),
})

export type OperationMeta = z.infer<typeof operationMetaSchema>
export type OperationPlanInput = z.infer<typeof operationPlanInputSchema>
export type OperationLaunchInput = z.infer<typeof operationLaunchInputSchema>
export type OperationOptions = z.infer<typeof operationOptionsSchema>

export const operationEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("updated"),
    operation: z.custom<Operation>(),
  }),
  z.object({
    type: z.literal("deleted"),
    operationId: z.string(),
  }),
])

export const operationOutputSchema = z.object({
  id: z.cuid2(),
  type: operationTypeSchema,
  status: operationStatusSchema,
  meta: operationMetaSchema,
  startedAt: z.date(),
  updatedAt: z.date(),
  finishedAt: z.date().nullable(),
})

export type OperationOutput = z.infer<typeof operationOutputSchema>

export type { Operation, OperationLog, OperationStatus, OperationType } from "../../../database"

export const finalOperationStatuses: OperationStatus[] = ["completed", "failed", "cancelled"]

/**
 * Checks if an operation status is final (stable).
 *
 * Final statuses are: completed, failed, cancelled
 * Transient statuses are: pending, running, failing
 *
 * @param status The operation status to check
 * @returns True if the status is final
 */
export function isFinalOperationStatus(status: OperationStatus): boolean {
  return finalOperationStatuses.includes(status)
}

/**
 * Checks if an operation status exists and is transient (not stable).
 *
 * @param status The operation status to check
 * @returns True if the status is transient
 */
export function isTransientOperationStatus(status?: OperationStatus): boolean {
  return !!status && !finalOperationStatuses.includes(status)
}
