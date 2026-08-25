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
