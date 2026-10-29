import type { ComponentModel, InstanceModel } from "@highstate/contract"
import type { ProjectEvaluationResult } from "../library"
import type { ResolvedInstanceInput } from "../shared"
import type { RuntimeExecutionService } from "./runtime-execution"

export type EvaluationRequest = {
  projectId: string
  librarySnapshotId: string
  modelRevision: string
  localOverlayRevision: string | null
  instances: InstanceModel[]
  virtualComponents: Record<string, ComponentModel>
  resolvedInputs: Record<string, Record<string, ResolvedInstanceInput[]>>
}

export class RuntimeEvaluationBackend {
  constructor(private readonly execution: RuntimeExecutionService) {}

  async evaluate(
    request: EvaluationRequest,
    signal?: AbortSignal,
  ): Promise<{ actionId: string; result: ProjectEvaluationResult }> {
    const runner = await this.execution.start(
      request.projectId,
      request.librarySnapshotId,
      "composite_evaluation",
      request.modelRevision,
      signal,
    )

    let actionId: string | undefined

    try {
      const action = await this.execution.coordinator.createAction({
        workloadId: runner.workload.id,
        kind: "composite_evaluation",
        ownerId: request.modelRevision,
        snapshotId: request.librarySnapshotId,
        imageDigest: runner.imageDigest,
      })

      actionId = action.id
      await this.execution.coordinator.dispatch(action.id, request, signal)
      const response = await this.execution.coordinator.waitForAction(action.id, signal)
      if (response.type !== "evaluationResult") {
        throw new Error(
          response.type === "error" ? response.message : "Unexpected evaluation result",
        )
      }

      const result = response.result as EvaluationRequest & { result: ProjectEvaluationResult }
      if (
        result.librarySnapshotId !== request.librarySnapshotId ||
        result.modelRevision !== request.modelRevision ||
        (result.localOverlayRevision ?? null) !== request.localOverlayRevision
      ) {
        throw new Error("Evaluation result revision mismatch")
      }

      return { actionId: action.id, result: result.result }
    } catch (cause) {
      throw Object.assign(new Error("Runtime evaluation failed", { cause }), { actionId })
    } finally {
      await this.cleanup(runner.workload.id, actionId)
    }
  }

  private async cleanup(workloadId: string, actionId: string | undefined): Promise<void> {
    try {
      await this.execution.coordinator.requestCleanup(workloadId)
    } catch (cause) {
      throw Object.assign(new Error("Runtime evaluation cleanup failed", { cause }), { actionId })
    }
  }
}
