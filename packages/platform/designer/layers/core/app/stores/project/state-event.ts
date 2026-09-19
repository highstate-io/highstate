import type { InstanceState } from "@highstate/backend/shared"

export function applyInstanceStatePatch(
  stateId: string,
  patch: Partial<InstanceState>,
  existingState?: InstanceState,
): InstanceState | undefined {
  if (!existingState && !patch.instanceId) {
    return undefined
  }

  return {
    ...existingState,
    ...patch,
    id: stateId,
  } as InstanceState
}
