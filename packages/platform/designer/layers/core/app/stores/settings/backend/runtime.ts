import type {
  ContainerRegistryCredentialOutput,
  ContainerRuntimeOutput,
  NpmRegistryCredentialOutput,
  PulumiStateBackendOutput,
  RuntimeSettingsInputs,
  RuntimeSettingsKind,
} from "@highstate/backend/shared"

export type RuntimeSettingsWrite = {
  [K in RuntimeSettingsKind]: { kind: K; id: string; value: RuntimeSettingsInputs[K] }
}[RuntimeSettingsKind]

export const useRuntimeSettingsStore = defineStore("runtime-settings", () => {
  const { $client } = useNuxtApp()
  const runtimes = ref<ContainerRuntimeOutput[]>([])
  const stateBackends = ref<PulumiStateBackendOutput[]>([])
  const npmCredentials = ref<NpmRegistryCredentialOutput[]>([])
  const ociCredentials = ref<ContainerRegistryCredentialOutput[]>([])
  const loading = ref(true)
  const error = ref("")

  const { unsubscribe } = $client.runtimeSettings.watch.subscribe(undefined, {
    onStarted() {
      loading.value = true
      error.value = ""
    },
    onData(result) {
      runtimes.value = result.runtimes
      stateBackends.value = result.stateBackends
      npmCredentials.value = result.npmCredentials
      ociCredentials.value = result.ociCredentials
      loading.value = false
      error.value = ""
    },
    onError(caught) {
      loading.value = false
      error.value = caught.message
    },
  })

  onScopeDispose(unsubscribe)

  async function put(input: RuntimeSettingsWrite) {
    return await $client.runtimeSettings.put.mutate(input)
  }

  async function remove(kind: RuntimeSettingsKind, id: string, revision: string) {
    await $client.runtimeSettings.delete.mutate({ kind, id, revision })
  }

  async function preflight(id: string) {
    return await $client.runtimeSettings.preflight.mutate({ id })
  }

  return {
    runtimes,
    stateBackends,
    npmCredentials,
    ociCredentials,
    loading,
    error,
    put,
    remove,
    preflight,
  }
})
