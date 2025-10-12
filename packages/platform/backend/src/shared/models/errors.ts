export class BackendError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = "BackendError"
  }
}

export class AccessError extends BackendError {
  constructor(message: string) {
    super(message)
    this.name = "AccessError"
  }
}

export class ProjectLockedError extends AccessError {
  constructor(projectId: string) {
    super(`The project with ID "${projectId}" is locked, decryption is not possible.`)
  }
}

export class ProjectNotFoundError extends BackendError {
  constructor(projectId: string) {
    super(`Project with ID "${projectId}" not found.`)
    this.name = "ProjectNotFoundError"
  }
}

export class CannotDeleteLastUnlockMethodError extends BackendError {
  constructor(projectId: string) {
    super(`Refused to delete the last unlock method for project "${projectId}".`)
    this.name = "CannotDeleteLastUnlockMethodError"
  }
}

export class InstanceNotFoundError extends BackendError {
  constructor(projectId: string, instanceId: string) {
    super(`Instance with ID "${instanceId}" not found in project "${projectId}".`)
    this.name = "InstanceNotFoundError"
  }
}

export class InvalidInstanceKindError extends BackendError {
  constructor(projectId: string, instanceId: string, expectedKind: string, actualKind: string) {
    super(
      `Instance "${instanceId}" in project "${projectId}" has kind "${actualKind}", but expected "${expectedKind}".`,
    )
    this.name = "InvalidInstanceKindError"
  }
}

export class OperationNotFoundError extends BackendError {
  constructor(projectId: string, operationId: string) {
    super(`Operation with ID "${operationId}" not found in project "${projectId}".`)
    this.name = "OperationNotFoundError"
  }
}

export class InstanceLockLostError extends BackendError {
  constructor(projectId: string, instanceIds: string[], token: string) {
    super(
      `Instance lock lost for instances [${instanceIds.join(", ")}] in project "${projectId}" with token "${token}".`,
    )
    this.name = "InstanceLockLostError"
  }
}

export class InstanceStateNotFoundError extends BackendError {
  constructor(projectId: string, instanceId: string) {
    super(`State for instance with ID "${instanceId}" not found in project "${projectId}".`)
    this.name = "InstanceStateNotFoundError"
  }
}

export class InstanceLockedError extends BackendError {
  constructor(projectId: string, instanceId: string) {
    super(`Instance with ID "${instanceId}" in project "${projectId}" is locked.`)
    this.name = "InstanceLockedError"
  }
}

export class WorkerVersionNotFoundError extends BackendError {
  constructor(projectId: string, workerVersionId: string) {
    super(`Worker version with ID "${workerVersionId}" not found in project "${projectId}".`)
    this.name = "WorkerVersionNotFoundError"
  }
}

export class BackendUnlockMethodNotFoundError extends BackendError {
  constructor(id: string) {
    super(`Backend unlock method with ID "${id}" not found.`)
    this.name = "BackendUnlockMethodNotFoundError"
  }
}

export class CannotDeleteLastBackendUnlockMethodError extends BackendError {
  constructor() {
    super(`Refused to delete the last backend unlock method.`)
    this.name = "CannotDeleteLastBackendUnlockMethodError"
  }
}
