import type * as runtime from "@prisma/client/runtime/client"
import { PrismaClient as BackendDatabase } from "./_generated/backend/postgresql/client"
import { PrismaClient as ProjectDatabase } from "./_generated/project/client"

export type BackendTransaction = Omit<BackendDatabase, runtime.ITXClientDenyList>
export type ProjectTransaction = Omit<ProjectDatabase, runtime.ITXClientDenyList>

export type {
  BackendUnlockMethod,
  Library,
  Project,
  ProjectSpace,
  PulumiBackend,
} from "./_generated/backend/postgresql/client"
export type {
  ApiKey,
  Artifact,
  InstanceCustomStatus,
  InstanceEvaluationState,
  InstanceEvaluationStatus,
  InstanceLock,
  InstanceOperationState,
  InstanceOperationStatus,
  InstanceSource,
  InstanceState,
  InstanceStatus,
  Operation,
  OperationLog,
  OperationStatus,
  OperationType,
  Page,
  Secret,
  ServiceAccount,
  Terminal,
  TerminalSession,
  TerminalSessionLog,
  TerminalStatus,
  Trigger,
  UnlockMethod,
  Worker,
  WorkerUnitRegistration,
  WorkerVersion,
  WorkerVersionLog,
} from "./_generated/project/client"
export type {
  InstanceEvaluationStateUncheckedCreateInput,
  InstanceEvaluationStateUpdateInput,
  InstanceOperationStateCreateInput,
  InstanceOperationStateCreateManyInput,
  InstanceOperationStateUpdateInput,
  InstanceStateInclude,
  InstanceStateUpdateInput,
  OperationUpdateInput,
} from "./_generated/project/models"
export { DbNull } from "./_generated/project/internal/prismaNamespace"

export { BackendDatabase, ProjectDatabase }
