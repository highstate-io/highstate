import type * as contract from "@highstate/contract"
import type * as shared from "../../shared"

declare global {
  // Common
  namespace PrismaJson {
    type CommonObjectMeta = contract.CommonObjectMeta
  }

  // Backend
  namespace PrismaJson {
    type LibrarySpec = shared.LibrarySpec
    type BackendUnlockMethodMeta = shared.BackendUnlockMethodMeta

    type PulumiBackendSpec = shared.PulumiBackendSpec
    type ProjectModelStorageSpec = shared.ProjectModelStorageSpec
  }

  // Project
  namespace PrismaJson {
    type InstanceId = contract.InstanceId
    type NullableInstanceId = contract.InstanceId | null
    type InstanceIds = contract.InstanceId[]
    type InstanceModel = contract.InstanceModel

    type InstanceArgs = Record<string, unknown>
    type InstanceResolvedInputs = Record<string, shared.StableInstanceInput[]>
    type UnlockMethodMeta = shared.UnlockMethodMeta
    type ProjectUnlockSuite = shared.ProjectUnlockSuite

    type InstanceStatusFields = contract.InstanceStatusField[]

    type OperationMeta = shared.OperationMeta
    type OperationOptions = shared.OperationOptions
    type OperationPhase = shared.OperationPhase

    type WorkerUnitRegistrationParams = Record<string, unknown>

    type ServiceAccountMeta = contract.ServiceAccountMeta

    type ApiKeyMeta = shared.ApiKeyMeta
    type InstanceArtifactIds = Record<string, string[]>
  }
}
