import type { BackendPermission } from "./backend"
import type { ProjectPermission } from "./project"

export enum BackendErrorCategory {
  InvalidArgument,
  Unauthenticated,
  PermissionDenied,
  NotFound,
  AlreadyExists,
  FailedPrecondition,
  Aborted,
  Unavailable,
  Internal,
}

export type BackendErrorFieldViolation = {
  field: string
  reason: string
  description: string
}

export type BackendErrorPreconditionViolation = {
  type: string
  subject: string
  description: string
}

export type BackendErrorRetry = {
  delayMs: number
}

export type BackendErrorOptions = {
  reason: string
  category: BackendErrorCategory
  metadata?: Readonly<Record<string, string>>
  fieldViolations?: readonly BackendErrorFieldViolation[]
  preconditionViolations?: readonly BackendErrorPreconditionViolation[]
  retry?: BackendErrorRetry
  cause?: unknown
}

export abstract class BackendError extends Error {
  readonly reason: string
  readonly category: BackendErrorCategory
  readonly metadata: Readonly<Record<string, string>>
  readonly fieldViolations: readonly BackendErrorFieldViolation[]
  readonly preconditionViolations: readonly BackendErrorPreconditionViolation[]
  readonly retry?: BackendErrorRetry

  protected constructor(message: string, options: BackendErrorOptions) {
    super(message, { cause: options.cause })
    this.name = new.target.name
    this.reason = options.reason
    this.category = options.category
    this.metadata = options.metadata ?? {}
    this.fieldViolations = options.fieldViolations ?? []
    this.preconditionViolations = options.preconditionViolations ?? []
    this.retry = options.retry
  }
}

export class MissingCredentialError extends BackendError {
  constructor(readonly credentialType: string) {
    super(`Credential of type "${credentialType}" is required`, {
      reason: "CREDENTIAL_MISSING",
      category: BackendErrorCategory.Unauthenticated,
      metadata: { credentialType },
    })
  }
}

export class InvalidCredentialError extends BackendError {
  constructor(readonly credentialType: string) {
    super(`Credential of type "${credentialType}" is invalid`, {
      reason: "CREDENTIAL_INVALID",
      category: BackendErrorCategory.Unauthenticated,
      metadata: { credentialType },
    })
  }
}

export class ApiKeyProjectMismatchError extends BackendError {
  constructor() {
    super("API key is not valid for the requested project", {
      reason: "API_KEY_PROJECT_MISMATCH",
      category: BackendErrorCategory.Unauthenticated,
    })
  }
}

export class PermissionDeniedError extends BackendError {
  constructor(readonly permission: BackendPermission | ProjectPermission) {
    super(`Permission "${permission}" is required`, {
      reason: "PERMISSION_REQUIRED",
      category: BackendErrorCategory.PermissionDenied,
      metadata: { permission },
    })
  }
}

export class WorkerOwnershipError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly workerVersionId: string,
  ) {
    super(`Worker version "${workerVersionId}" is not owned by the caller`, {
      reason: "WORKER_VERSION_NOT_OWNED",
      category: BackendErrorCategory.PermissionDenied,
      metadata: { projectId, workerVersionId },
    })
  }
}

export class WorkerRegistrationNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly stateId: string,
    readonly workerVersionId: string,
  ) {
    super(`Worker version "${workerVersionId}" is not registered for state "${stateId}"`, {
      reason: "WORKER_REGISTRATION_NOT_FOUND",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { projectId, stateId, workerVersionId },
      preconditionViolations: [
        {
          type: "WORKER_REGISTRATION_REQUIRED",
          subject: stateId,
          description: "The worker version must be registered for the instance state",
        },
      ],
    })
  }
}

export class ProjectLockedError extends BackendError {
  constructor(readonly projectId: string) {
    super(`Project "${projectId}" is locked`, {
      reason: "PROJECT_LOCKED",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { projectId },
      preconditionViolations: [
        {
          type: "PROJECT_UNLOCKED_REQUIRED",
          subject: projectId,
          description: "The project must be unlocked before this operation can continue",
        },
      ],
    })
  }
}

export class ProjectNotFoundError extends BackendError {
  constructor(readonly projectId: string) {
    super(`Project "${projectId}" not found`, {
      reason: "PROJECT_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId },
    })
  }
}

export class CannotDeleteLastUnlockMethodError extends BackendError {
  constructor(readonly projectId: string) {
    super(`Cannot delete the last unlock method for project "${projectId}"`, {
      reason: "LAST_PROJECT_UNLOCK_METHOD",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { projectId },
      preconditionViolations: [
        {
          type: "UNLOCK_METHOD_REQUIRED",
          subject: projectId,
          description: "The project must retain at least one unlock method",
        },
      ],
    })
  }
}

export class InstanceNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly instanceId: string,
  ) {
    super(`Instance "${instanceId}" not found in project "${projectId}"`, {
      reason: "INSTANCE_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, instanceId },
    })
  }
}

export class InvalidInstanceKindError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly instanceId: string,
    readonly expectedKind: string,
    readonly actualKind: string,
  ) {
    super(
      `Instance "${instanceId}" in project "${projectId}" has kind "${actualKind}", but "${expectedKind}" is required`,
      {
        reason: "INSTANCE_KIND_INVALID",
        category: BackendErrorCategory.InvalidArgument,
        metadata: { projectId, instanceId, expectedKind, actualKind },
      },
    )
  }
}

export class OperationNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly operationId: string,
  ) {
    super(`Operation "${operationId}" not found in project "${projectId}"`, {
      reason: "OPERATION_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, operationId },
    })
  }
}

export class InvalidOperationPlanError extends BackendError {
  constructor(message: string) {
    super(message, {
      reason: "OPERATION_PLAN_INVALID",
      category: BackendErrorCategory.InvalidArgument,
    })
  }
}

export class InstanceLockLostError extends BackendError {
  readonly instanceIds: readonly string[]

  constructor(
    readonly projectId: string,
    instanceIds: readonly string[],
  ) {
    super(`Instance lock was lost in project "${projectId}"`, {
      reason: "INSTANCE_LOCK_LOST",
      category: BackendErrorCategory.Aborted,
      metadata: { projectId },
      preconditionViolations: instanceIds.slice(0, 20).map(instanceId => ({
        type: "INSTANCE_LOCK_REQUIRED",
        subject: instanceId,
        description: "The instance lock must still be owned by the operation",
      })),
    })
    this.instanceIds = instanceIds
  }
}

export class InstanceStateNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly stateId: string,
  ) {
    super(`Instance state "${stateId}" not found in project "${projectId}"`, {
      reason: "INSTANCE_STATE_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, stateId },
    })
  }
}

export class InstanceStateForInstanceNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly instanceId: string,
  ) {
    super(`State for instance "${instanceId}" not found in project "${projectId}"`, {
      reason: "INSTANCE_STATE_FOR_INSTANCE_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, instanceId },
    })
  }
}

export class InstanceLockedError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly instanceId: string,
  ) {
    super(`Instance "${instanceId}" in project "${projectId}" is locked`, {
      reason: "INSTANCE_LOCKED",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { projectId, instanceId },
      preconditionViolations: [
        {
          type: "INSTANCE_UNLOCKED_REQUIRED",
          subject: instanceId,
          description: "The instance must be unlocked before this operation can continue",
        },
      ],
    })
  }
}

export class WorkerVersionNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly workerVersionId: string,
  ) {
    super(`Worker version "${workerVersionId}" not found in project "${projectId}"`, {
      reason: "WORKER_VERSION_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, workerVersionId },
    })
  }
}

export class BackendUnlockMethodNotFoundError extends BackendError {
  constructor(readonly unlockMethodId: string) {
    super(`Backend unlock method "${unlockMethodId}" not found`, {
      reason: "BACKEND_UNLOCK_METHOD_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { unlockMethodId },
    })
  }
}

export class CannotDeleteLastBackendUnlockMethodError extends BackendError {
  constructor() {
    super("Cannot delete the last backend unlock method", {
      reason: "LAST_BACKEND_UNLOCK_METHOD",
      category: BackendErrorCategory.FailedPrecondition,
      preconditionViolations: [
        {
          type: "UNLOCK_METHOD_REQUIRED",
          subject: "backend",
          description: "The backend must retain at least one unlock method",
        },
      ],
    })
  }
}

export class InvalidPageTokenError extends BackendError {
  constructor(
    readonly collection: string,
    readonly violationReason: string,
  ) {
    super(`Page token is invalid for collection "${collection}"`, {
      reason: "PAGE_TOKEN_INVALID",
      category: BackendErrorCategory.InvalidArgument,
      metadata: { collection },
      fieldViolations: [
        {
          field: "pageToken",
          reason: violationReason,
          description: "The page token is malformed or does not match this collection query",
        },
      ],
    })
  }
}

export class InvalidPageSizeError extends BackendError {
  constructor(readonly pageSize: number) {
    super("Page size must be a non-negative integer", {
      reason: "PAGE_SIZE_INVALID",
      category: BackendErrorCategory.InvalidArgument,
      metadata: { pageSize: String(pageSize) },
      fieldViolations: [
        {
          field: "pageSize",
          reason: "OUT_OF_RANGE",
          description: "The page size must be a non-negative integer",
        },
      ],
    })
  }
}

export class ComponentNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly componentType: string,
  ) {
    super(`Component "${componentType}" not found in project "${projectId}"`, {
      reason: "COMPONENT_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, componentType },
    })
  }
}

export class ProjectApiKeyNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly apiKeyId: string,
  ) {
    super(`Project API key "${apiKeyId}" not found in project "${projectId}"`, {
      reason: "PROJECT_API_KEY_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, apiKeyId },
    })
  }
}

export class BackendApiKeyNotFoundError extends BackendError {
  constructor(readonly apiKeyId: string) {
    super(`Backend API key "${apiKeyId}" not found`, {
      reason: "BACKEND_API_KEY_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { apiKeyId },
    })
  }
}

export class ProjectServiceAccountNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly serviceAccountId: string,
  ) {
    super(`Project service account "${serviceAccountId}" not found in project "${projectId}"`, {
      reason: "PROJECT_SERVICE_ACCOUNT_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, serviceAccountId },
    })
  }
}

export class BackendServiceAccountNotFoundError extends BackendError {
  constructor(readonly serviceAccountId: string) {
    super(`Backend service account "${serviceAccountId}" not found`, {
      reason: "BACKEND_SERVICE_ACCOUNT_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { serviceAccountId },
    })
  }
}

export class ProjectRoleNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly roleId: string,
  ) {
    super(`Project role "${roleId}" not found in project "${projectId}"`, {
      reason: "PROJECT_ROLE_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, roleId },
    })
  }
}

export class BackendRoleNotFoundError extends BackendError {
  constructor(readonly roleId: string) {
    super(`Backend role "${roleId}" not found`, {
      reason: "BACKEND_ROLE_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { roleId },
    })
  }
}

export class AuthorizationResourceNotFoundError extends BackendError {
  constructor(
    readonly realm: string,
    readonly resourceType: string,
    readonly resourceId: string,
    readonly projectId?: string,
  ) {
    super(`Authorization resource "${resourceType}/${resourceId}" not found in realm "${realm}"`, {
      reason: "AUTHORIZATION_RESOURCE_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: {
        realm,
        resourceType,
        resourceId,
        ...(projectId ? { projectId } : {}),
      },
    })
  }
}

export class PermissionGroupNotFoundError extends BackendError {
  constructor(
    readonly realm: string,
    readonly groupName: string,
  ) {
    super(`Permission group "${groupName}" not found in realm "${realm}"`, {
      reason: "PERMISSION_GROUP_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { realm, groupName },
    })
  }
}

export class PermissionGroupResourceUnsupportedError extends BackendError {
  constructor(
    readonly realm: string,
    readonly groupName: string,
    readonly resourceId?: string,
  ) {
    super(`Permission group "${groupName}" does not support resources in realm "${realm}"`, {
      reason: "PERMISSION_GROUP_RESOURCE_UNSUPPORTED",
      category: BackendErrorCategory.InvalidArgument,
      metadata: {
        realm,
        groupName,
        ...(resourceId ? { resourceId } : {}),
      },
      fieldViolations: [
        {
          field: "resourceId",
          reason: "UNSUPPORTED",
          description: "This permission group does not support a resource identifier",
        },
      ],
    })
  }
}

export class PermissionEscalationError extends BackendError {
  constructor(readonly permission: string) {
    super(`Permission "${permission}" exceeds the service account permissions`, {
      reason: "PERMISSION_ESCALATION",
      category: BackendErrorCategory.PermissionDenied,
      metadata: { permission },
    })
  }
}

export class RequiredSystemResourceNotFoundError extends BackendError {
  constructor(readonly resourceType: string) {
    super(`Required system resource "${resourceType}" not found`, {
      reason: "SYSTEM_RESOURCE_NOT_FOUND",
      category: BackendErrorCategory.Internal,
    })
  }
}

export class DatabaseVersionUnsupportedError extends BackendError {
  constructor(
    readonly databaseType: string,
    readonly currentVersion: number,
    readonly supportedVersion: number,
  ) {
    super(`The ${databaseType} database version is newer than supported`, {
      reason: "DATABASE_VERSION_UNSUPPORTED",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: {
        databaseType,
        currentVersion: String(currentVersion),
        supportedVersion: String(supportedVersion),
      },
      preconditionViolations: [
        {
          type: "DATABASE_VERSION_SUPPORTED",
          subject: databaseType,
          description: "Highstate must be upgraded to support this database version",
        },
      ],
    })
  }
}

export class ProjectUnlockMethodNotFoundError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly unlockMethodId: string,
  ) {
    super(`Project unlock method "${unlockMethodId}" not found in project "${projectId}"`, {
      reason: "PROJECT_UNLOCK_METHOD_NOT_FOUND",
      category: BackendErrorCategory.NotFound,
      metadata: { projectId, unlockMethodId },
    })
  }
}

export class DuplicatePanelNameError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly stateId: string,
    readonly panelName: string,
    readonly panelIndex?: number,
  ) {
    const field = panelIndex === undefined ? "panels" : `panels.${panelIndex}.name`
    super(`Panel name "${panelName}" is duplicated`, {
      reason: "PANEL_NAME_DUPLICATE",
      category: BackendErrorCategory.AlreadyExists,
      metadata: { projectId, stateId, panelName },
      fieldViolations: [
        {
          field,
          reason: "DUPLICATE",
          description: "Panel names must be unique within an instance registration",
        },
      ],
    })
  }
}

export class WorkerManagedApiKeyReadOnlyError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly apiKeyId: string,
  ) {
    super(`Worker-managed project API key "${apiKeyId}" is read-only`, {
      reason: "WORKER_MANAGED_API_KEY_READ_ONLY",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { projectId, apiKeyId },
      preconditionViolations: [readOnlyViolation(apiKeyId)],
    })
  }
}

export class SystemProjectServiceAccountReadOnlyError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly serviceAccountId: string,
  ) {
    super(`System project service account "${serviceAccountId}" is read-only`, {
      reason: "SYSTEM_PROJECT_SERVICE_ACCOUNT_READ_ONLY",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { projectId, serviceAccountId },
      preconditionViolations: [readOnlyViolation(serviceAccountId)],
    })
  }
}

export class SystemBackendServiceAccountReadOnlyError extends BackendError {
  constructor(readonly serviceAccountId: string) {
    super(`System backend service account "${serviceAccountId}" is read-only`, {
      reason: "SYSTEM_BACKEND_SERVICE_ACCOUNT_READ_ONLY",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { serviceAccountId },
      preconditionViolations: [readOnlyViolation(serviceAccountId)],
    })
  }
}

export class SystemProjectRoleReadOnlyError extends BackendError {
  constructor(
    readonly projectId: string,
    readonly roleId: string,
  ) {
    super(`System project role "${roleId}" is read-only`, {
      reason: "SYSTEM_PROJECT_ROLE_READ_ONLY",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { projectId, roleId },
      preconditionViolations: [readOnlyViolation(roleId)],
    })
  }
}

export class SystemBackendRoleReadOnlyError extends BackendError {
  constructor(readonly roleId: string) {
    super(`System backend role "${roleId}" is read-only`, {
      reason: "SYSTEM_BACKEND_ROLE_READ_ONLY",
      category: BackendErrorCategory.FailedPrecondition,
      metadata: { roleId },
      preconditionViolations: [readOnlyViolation(roleId)],
    })
  }
}

function readOnlyViolation(subject: string): BackendErrorPreconditionViolation {
  return {
    type: "RESOURCE_READ_ONLY",
    subject,
    description: "The resource is managed by the system and cannot be modified",
  }
}
