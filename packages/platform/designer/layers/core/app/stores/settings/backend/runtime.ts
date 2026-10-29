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
  const loading = ref(false)

  async function load() {
    loading.value = true

    try {
      const result = await $client.runtimeSettings.list.query()
      runtimes.value = result.runtimes
      stateBackends.value = result.stateBackends
      npmCredentials.value = result.npmCredentials
      ociCredentials.value = result.ociCredentials
    } finally {
      loading.value = false
    }
  }

  async function put(input: RuntimeSettingsWrite) {
    return await $client.runtimeSettings.put.mutate(input)
  }

  async function remove(kind: RuntimeSettingsKind, id: string, revision: number) {
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
    load,
    put,
    remove,
    preflight,
  }
})
