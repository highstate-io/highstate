import type * as contract from "@highstate/contract"
import type * as shared from "../../shared"

declare global {
  // common
  namespace PrismaJson {
    type CommonObjectMeta = contract.CommonObjectMeta
  }

  // backend
  namespace PrismaJson {
    type BackendUnlockMethodMeta = shared.BackendUnlockMethodMeta

    type LegacyProjectExecutionConfig = {
      libraryId: string
      pulumiBackendId: string
      librarySpec: { type: string }
      libraryMeta: contract.CommonObjectMeta
      pulumiBackendSpec: { type: string }
      pulumiBackendMeta: contract.CommonObjectMeta
    }
    type PulumiStateBackendSpec = shared.PulumiStateBackendSpec
    type ContainerRuntimeSpec = shared.ContainerRuntimeSpec
    type ProjectModelStorageSpec = shared.ProjectModelStorageSpec
    type BackendRoleRules = shared.BackendRoleRules
    type UserGroupMeta = shared.UserGroupMeta
    type UserMeta = shared.UserMeta
    type LibraryImageProgress = shared.LibraryImageProgress
  }

  // project
  namespace PrismaJson {
    type SelectedLibraryPackages = contract.SelectedLibraryPackage[]
    type LibrarySourceManifest = contract.LibrarySourceManifest
    type LibrarySnapshotSourceManifest = contract.LibrarySnapshotSourceManifest
    type LibraryPackageMetadata = contract.LibraryPackageMetadata
    type LibraryCompatibility = contract.LibraryCompatibility
    type InstanceId = contract.InstanceId
    type NullableInstanceId = contract.InstanceId | null
    type InstanceIds = contract.InstanceId[]
    type InstanceModel = contract.InstanceModel
    type EntityMeta = Partial<contract.CommonObjectMeta>

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
    type ProjectRoleRules = shared.ProjectRoleRules
    type InstanceArtifactIds = Record<string, string[]>
  }
}
