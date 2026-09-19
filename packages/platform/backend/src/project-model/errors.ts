import { BackendError, BackendErrorCategory, type BackendErrorOptions } from "../shared"

export abstract class ProjectModelError extends BackendError {
  protected constructor(message: string, options: BackendErrorOptions) {
    super(message, options)
  }
}

export class ProjectModelBackendNotFoundError extends ProjectModelError {
  constructor(readonly backendType: string) {
    super(`Project model backend "${backendType}" not found`, {
      reason: "PROJECT_MODEL_BACKEND_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { backendType },
    })
  }
}

export class ProjectModelNotFoundError extends ProjectModelError {
  constructor(readonly projectId: string) {
    super(`Project model not found for project "${projectId}"`, {
      reason: "PROJECT_MODEL_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId },
    })
  }
}

export class ProjectModelInstanceNotFoundError extends ProjectModelError {
  constructor(
    readonly projectId: string,
    readonly instanceId: string,
  ) {
    super(`Instance "${instanceId}" not found in project "${projectId}"`, {
      reason: "PROJECT_MODEL_INSTANCE_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, instanceId },
    })
  }
}

export class ProjectModelHubNotFoundError extends ProjectModelError {
  constructor(
    readonly projectId: string,
    readonly hubId: string,
  ) {
    super(`Hub "${hubId}" not found in project "${projectId}"`, {
      reason: "PROJECT_MODEL_HUB_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, hubId },
    })
  }
}

export class ProjectModelInstanceAlreadyExistsError extends ProjectModelError {
  constructor(
    readonly projectId: string,
    readonly instanceId: string,
  ) {
    super(`Instance "${instanceId}" already exists in project "${projectId}"`, {
      reason: "INSTANCE_ALREADY_EXISTS",
      category: BackendErrorCategory.AlreadyExists,
      metadata: { projectId, instanceId },
    })
  }
}

export class ProjectModelHubAlreadyExistsError extends ProjectModelError {
  constructor(
    readonly projectId: string,
    readonly hubId: string,
  ) {
    super(`Hub "${hubId}" already exists in project "${projectId}"`, {
      reason: "HUB_ALREADY_EXISTS",
      category: BackendErrorCategory.AlreadyExists,
      metadata: { projectId, hubId },
    })
  }
}

export class ProjectModelOperationError extends ProjectModelError {
  constructor(
    readonly operation: string,
    readonly projectId: string,
    cause?: unknown,
  ) {
    super(`Failed to ${operation} for project "${projectId}"`, {
      reason: "PROJECT_MODEL_OPERATION_FAILED",
      category: BackendErrorCategory.Internal,
      metadata: { projectId, operation },
      cause,
    })
  }
}

export class ProjectModelArgumentPatchError extends ProjectModelError {
  constructor(
    readonly operationIndex: number,
    readonly path: string,
    readonly violationReason: string,
    description: string,
    cause?: unknown,
  ) {
    super(`Instance argument patch operation ${operationIndex + 1} is invalid`, {
      reason: "INSTANCE_ARGUMENT_PATCH_INVALID",
      category: BackendErrorCategory.InvalidArgument,
      metadata: { operationIndex: String(operationIndex), violationReason },
      fieldViolations: [
        {
          field: `operations.${operationIndex}.path`,
          reason: violationReason,
          description,
        },
      ],
      cause,
    })
  }
}

export class ProjectModelArgumentsInvalidError extends ProjectModelError {
  constructor(readonly violations: readonly { argument: string; description: string }[]) {
    super("Patched instance arguments do not satisfy the component schema", {
      reason: "INSTANCE_ARGUMENTS_INVALID",
      category: BackendErrorCategory.InvalidArgument,
      fieldViolations: violations.map(violation => ({
        field: `arguments.${violation.argument}`,
        reason: "SCHEMA_INVALID",
        description: violation.description,
      })),
    })
  }
}

export class ProjectModelCircularInputReferenceError extends ProjectModelError {
  readonly cycle: readonly string[]

  constructor(
    readonly projectId: string,
    cycle: readonly string[],
  ) {
    const boundedCycle = cycle.slice(0, 20)
    super(`Circular input reference detected in project "${projectId}"`, {
      reason: "CIRCULAR_INPUT_REFERENCE",
      category: BackendErrorCategory.InvalidArgument,
      metadata: { projectId },
      fieldViolations: [
        {
          field: "inputs",
          reason: "CIRCULAR_REFERENCE",
          description: `The input reference cycle is ${boundedCycle.join(" -> ")}`,
        },
      ],
    })
    this.cycle = cycle
  }
}
