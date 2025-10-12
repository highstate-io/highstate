import { BackendError } from "../shared"

/**
 * Base error class for all project model related errors.
 */
export class ProjectModelError extends BackendError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = "ProjectModelError"
  }
}

/**
 * Error thrown when a project model backend is not found for the given type.
 */
export class ProjectModelBackendNotFoundError extends ProjectModelError {
  constructor(backendType: string) {
    super(`Project model backend "${backendType}" not found`)
    this.name = "ProjectModelBackendNotFoundError"
  }
}

/**
 * Error thrown when a project model is not found.
 */
export class ProjectModelNotFoundError extends ProjectModelError {
  constructor(projectId: string) {
    super(`Project model not found for project "${projectId}"`)
    this.name = "ProjectModelNotFoundError"
  }
}

/**
 * Error thrown when an instance is not found in the project model.
 */
export class ProjectModelInstanceNotFoundError extends ProjectModelError {
  constructor(projectId: string, instanceId: string) {
    super(`Instance "${instanceId}" not found in project "${projectId}"`)
    this.name = "ProjectModelInstanceNotFoundError"
  }
}

/**
 * Error thrown when a hub is not found in the project model.
 */
export class ProjectModelHubNotFoundError extends ProjectModelError {
  constructor(projectId: string, hubId: string) {
    super(`Hub "${hubId}" not found in project "${projectId}"`)
    this.name = "ProjectModelHubNotFoundError"
  }
}

/**
 * Error thrown when attempting to create an instance that already exists.
 */
export class ProjectModelInstanceAlreadyExistsError extends ProjectModelError {
  constructor(projectId: string, instanceId: string) {
    super(`Instance "${instanceId}" already exists in project "${projectId}"`)
    this.name = "ProjectModelInstanceAlreadyExistsError"
  }
}

/**
 * Error thrown when attempting to create a hub that already exists.
 */
export class ProjectModelHubAlreadyExistsError extends ProjectModelError {
  constructor(projectId: string, hubId: string) {
    super(`Hub "${hubId}" already exists in project "${projectId}"`)
    this.name = "ProjectModelHubAlreadyExistsError"
  }
}

/**
 * Error thrown when a project model operation fails.
 */
export class ProjectModelOperationError extends ProjectModelError {
  constructor(operation: string, projectId: string, cause?: unknown) {
    super(`Failed to ${operation} for project "${projectId}"`, cause)
    this.name = "ProjectModelOperationError"
  }
}
