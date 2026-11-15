import type { ProjectUnlockState } from "@highstate/backend/shared"
import type { Decrypter } from "age-encryption"
import { armor } from "age-encryption"

// unlocking must not initialize model, worker, or operation stores: callers may
// be allowed to open a project without permission to read any of those resources.
export function useProjectUnlockState(projectId: string) {
  const { $client } = useNuxtApp()
  const unlockState = ref<ProjectUnlockState>()
  const failure = shallowRef<unknown>()
  const access = useAccess()
  const requirement = { permission: "project.get" as const, target: { projectId } }
  let subscription: { unsubscribe: () => void } | undefined
  let retry: ReturnType<typeof setTimeout> | undefined

  const stop = () => {
    clearTimeout(retry)
    subscription?.unsubscribe()
    subscription = undefined
  }

  const connect = () => {
    stop()

    if (!access.status(requirement).allowed) {
      return
    }

    failure.value = undefined

    subscription = $client.state.watchUnlockState.subscribe(
      { projectId },
      {
        onData: state => {
          failure.value = undefined
          unlockState.value = state
        },
        onError: error => {
          unlockState.value = undefined
          failure.value = error
          retry = setTimeout(connect, 1000)
        },
      },
    )
  }

  watch(
    () => access.status(requirement),
    status => {
      stop()
      unlockState.value = undefined

      if (status.allowed) {
        connect()
      } else if (!status.pending) {
        failure.value = Object.assign(new Error(status.reason), { statusCode: 403 })
      }
    },
    { immediate: true },
  )

  onScopeDispose(stop)

  const isUnlockImpossible = computed(
    () =>
      unlockState.value?.type === "locked" &&
      !unlockState.value.unlockSuite?.encryptedIdentities.length,
  )

  const unlockWithIdentity = async (decryptedIdentity: string) => {
    await $client.state.unlockProject.mutate({ projectId, decryptedIdentity })
  }

  const unlock = async (decrypter: Decrypter) => {
    if (unlockState.value?.type !== "locked" || !unlockState.value.unlockSuite) {
      return false
    }

    for (const identity of unlockState.value.unlockSuite.encryptedIdentities) {
      let decrypted: string

      try {
        decrypted = await decrypter.decrypt(armor.decode(identity), "text")
      } catch {
        continue
      }

      await unlockWithIdentity(decrypted)
      return true
    }

    return false
  }

  return { unlockState, failure, isUnlockImpossible, unlock, unlockWithIdentity }
}
