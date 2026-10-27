<script setup lang="ts">
import type { RuntimeSettingsKind, RuntimeSettingsOutputs } from "@highstate/backend/shared"
import {
  containerRuntimeInputSchema,
  pulumiStateBackendInputSchema,
  npmRegistryCredentialInputSchema,
  containerRegistryCredentialInputSchema,
} from "@highstate/backend/shared"
import type { RuntimeSettingsWrite } from "../../../stores/settings/backend/runtime"
import RuntimeSecretField from "./RuntimeSecretField.vue"

const props = defineProps<{
  kind: RuntimeSettingsKind
  item: RuntimeSettingsOutputs[RuntimeSettingsKind] | null
}>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ changed: [] }>()
const store = useRuntimeSettingsStore()
const selected = shallowRef(props.item)
const busy = ref(false)
const conflict = ref(false)
const error = ref("")
const confirmDelete = ref(false)
const checks = ref<{ name: string; ok: boolean; detail?: string }[]>([])
const draft = reactive({
  id: "",
  title: "",
  description: "",
  type: "docker" as "docker" | "kubernetes",
  runtimeApiUrl: "",
  runtimeApiCaBundle: "",
  imageRepository: "",
  engineEndpoint: "unix:///var/run/docker.sock",
  local: true,
  namespace: "highstate",
  serviceAccount: "highstate",
  buildkitImage: "moby/buildkit:rootless",
  context: "",
  url: "",
  registryUrl: "",
  scope: "",
  username: "",
  npmRegistryCredentialIds: [] as string[],
  containerRegistryCredentialIds: [] as string[],
})
const secrets = reactive({
  caBundle: "",
  clientCertificate: "",
  clientKey: "",
  kubeconfig: "",
  credentials: "",
  token: "",
  password: "",
})
const clear = reactive({
  caBundle: false,
  clientCertificate: false,
  clientKey: false,
  kubeconfig: false,
  credentials: false,
})
const runtime = computed(() =>
  selected.value && "npmRegistryCredentialIds" in selected.value ? selected.value : null,
)
const state = computed(() =>
  selected.value && "spec" in selected.value && "url" in selected.value.spec
    ? selected.value.spec
    : null,
)
const credentialsConfigured = computed(
  () =>
    selected.value &&
    "credentialsConfigured" in selected.value &&
    selected.value.credentialsConfigured,
)

function reset(item: typeof props.item) {
  selected.value = item
  Object.assign(draft, {
    id: item?.id ?? "",
    title: item?.meta.title ?? "",
    description: item?.meta.description ?? "",
    type: "docker",
    runtimeApiUrl: "",
    runtimeApiCaBundle: "",
    imageRepository: "",
    engineEndpoint: "unix:///var/run/docker.sock",
    local: true,
    namespace: "highstate",
    serviceAccount: "highstate",
    buildkitImage: "moby/buildkit:rootless",
    context: "",
    url: "",
    registryUrl: "",
    scope: "",
    username: "",
    npmRegistryCredentialIds: [],
    containerRegistryCredentialIds: [],
  })
  if (item && "spec" in item) {
    Object.assign(draft, item.spec)
  }
  if (item && "npmRegistryCredentialIds" in item) {
    draft.npmRegistryCredentialIds = [...item.npmRegistryCredentialIds]
    draft.containerRegistryCredentialIds = [...item.containerRegistryCredentialIds]
  }
  if (item && "registryUrl" in item) draft.registryUrl = item.registryUrl
  if (item && "scope" in item) draft.scope = item.scope
  for (const key of Object.keys(secrets) as (keyof typeof secrets)[]) secrets[key] = ""
  for (const key of Object.keys(clear) as (keyof typeof clear)[]) clear[key] = false
  error.value = ""
  conflict.value = false
  confirmDelete.value = false
  checks.value = []
}

watch(
  () => [visible.value, props.item, props.kind] as const,
  () => {
    if (visible.value) reset(props.item)
    else reset(null)
  },
  { immediate: true },
)

function secret(key: keyof typeof clear) {
  return clear[key] ? null : secrets[key] || undefined
}

function input(): RuntimeSettingsWrite {
  const base = {
    revision: selected.value?.revision ?? 0,
    meta: {
      ...selected.value?.meta,
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
    },
  }
  const id = draft.id.trim()
  if (!id) throw new Error("ID is required")
  switch (props.kind) {
    case "container-runtime": {
      const common = {
        runtimeApiUrl: draft.runtimeApiUrl,
        runtimeApiCaBundle: draft.runtimeApiCaBundle || undefined,
        imageRepository: draft.imageRepository || undefined,
      }
      const spec =
        draft.type === "docker"
          ? {
              ...common,
              type: draft.type,
              engineEndpoint: draft.engineEndpoint,
              local: draft.local,
              tls: {
                caBundle: secret("caBundle"),
                clientCertificate: secret("clientCertificate"),
                clientKey: secret("clientKey"),
              },
            }
          : {
              ...common,
              type: draft.type,
              namespace: draft.namespace,
              serviceAccount: draft.serviceAccount,
              buildkitImage: draft.buildkitImage,
              context: draft.context || undefined,
              kubeconfig: secret("kubeconfig"),
            }
      return {
        kind: props.kind,
        id,
        value: containerRuntimeInputSchema.parse({
          ...base,
          spec,
          npmRegistryCredentialIds: draft.npmRegistryCredentialIds,
          containerRegistryCredentialIds: draft.containerRegistryCredentialIds,
        }),
      }
    }
    case "pulumi-state-backend":
      return {
        kind: props.kind,
        id,
        value: pulumiStateBackendInputSchema.parse({
          ...base,
          spec: { url: draft.url, credentials: secret("credentials") },
        }),
      }
    case "npm-registry-credential":
      if (!credentialsConfigured.value && !secrets.token)
        throw new Error("A token is required for a new credential")
      return {
        kind: props.kind,
        id,
        value: npmRegistryCredentialInputSchema.parse({
          ...base,
          scope: draft.scope,
          registryUrl: draft.registryUrl,
          credentials: secrets.token ? { token: secrets.token } : undefined,
        }),
      }
    case "container-registry-credential":
      if (!credentialsConfigured.value && !secrets.password)
        throw new Error("Username and password are required for a new credential")
      if (!!draft.username !== !!secrets.password)
        throw new Error("Enter both username and password to replace credentials")
      return {
        kind: props.kind,
        id,
        value: containerRegistryCredentialInputSchema.parse({
          ...base,
          registryUrl: draft.registryUrl,
          credentials: secrets.password
            ? { username: draft.username, password: secrets.password }
            : undefined,
        }),
      }
  }
}

function failed(caught: unknown) {
  error.value = caught instanceof Error ? caught.message : "Request failed"
  if (typeof caught === "object" && caught !== null && "data" in caught) {
    const data = caught.data
    if (typeof data === "object" && data !== null && "code" in data && data.code === "CONFLICT")
      conflict.value = true
  }
}

async function save() {
  if (busy.value || conflict.value) return
  busy.value = true
  error.value = ""
  try {
    const result = await store.put(input())
    reset(result)
    emit("changed")
  } catch (caught) {
    failed(caught)
  } finally {
    busy.value = false
  }
}

async function reload() {
  if (busy.value) return
  busy.value = true
  try {
    await store.load()
    const collections = {
      "container-runtime": store.runtimes,
      "pulumi-state-backend": store.stateBackends,
      "npm-registry-credential": store.npmCredentials,
      "container-registry-credential": store.ociCredentials,
    }
    const item = collections[props.kind].find(item => item.id === draft.id.trim())
    if (!item) {
      visible.value = false
      emit("changed")
      return
    }
    reset(item)
  } catch (caught) {
    failed(caught)
  } finally {
    busy.value = false
  }
}

async function remove() {
  if (!selected.value || busy.value || conflict.value) return
  busy.value = true
  error.value = ""
  try {
    await store.remove(props.kind, selected.value.id, selected.value.revision)
    visible.value = false
    emit("changed")
  } catch (caught) {
    failed(caught)
  } finally {
    busy.value = false
  }
}

async function preflight() {
  if (!selected.value || busy.value || conflict.value) return
  busy.value = true
  checks.value = []
  error.value = ""
  try {
    checks.value = await store.preflight(selected.value.id)
  } catch (caught) {
    failed(caught)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <VDialog v-model="visible" max-width="850" :persistent="busy" scrollable>
    <VCard :title="selected ? 'Edit setting' : 'Create setting'">
      <VCardText>
        <VAlert v-if="error" type="error" class="mb-4" style="white-space: pre-wrap"
          >{{ error }}</VAlert
        >
        <VAlert v-if="conflict" type="warning" class="mb-4">
          This setting changed or was deleted. Reload the current record before saving or deleting
          again. Reload discards your edits.
          <VBtn class="mt-2" :loading="busy" @click="reload">Reload current record</VBtn>
        </VAlert>
        <VForm :disabled="busy || conflict" @submit.prevent="save">
          <VTextField v-model="draft.id" label="ID" :disabled="!!selected" />
          <VTextField v-model="draft.title" label="Title" />
          <VTextarea v-model="draft.description" label="Description" rows="2" />
          <div v-if="selected" class="text-caption mb-4">Revision {{ selected.revision }}</div>
          <template v-if="kind === 'container-runtime'">
            <VSelect v-model="draft.type" :items="['docker', 'kubernetes']" label="Runtime type" />
            <VTextField v-model="draft.runtimeApiUrl" label="Runtime API URL (HTTPS)" />
            <VTextarea
              v-model="draft.runtimeApiCaBundle"
              label="Runtime API CA bundle (optional)"
              rows="3"
            />
            <VTextField
              v-model="draft.imageRepository"
              label="OCI image repository"
              :hint="draft.type === 'kubernetes' || !draft.local ? 'Required for remote runtimes' : 'Optional for local Docker'"
              persistent-hint
            />
            <template v-if="draft.type === 'docker'">
              <VTextField v-model="draft.engineEndpoint" label="Docker engine endpoint" />
              <VCheckbox v-model="draft.local" label="Local Docker runtime" />
              <RuntimeSecretField
                v-model="secrets.caBundle"
                v-model:clear="clear.caBundle"
                label="Docker CA bundle"
                :configured="runtime?.spec.type === 'docker' && runtime.spec.tls.caBundleConfigured"
                clearable
                multiline
              />
              <RuntimeSecretField
                v-model="secrets.clientCertificate"
                v-model:clear="clear.clientCertificate"
                label="Docker client certificate"
                :configured="runtime?.spec.type === 'docker' && runtime.spec.tls.clientCertificateConfigured"
                clearable
                multiline
              />
              <RuntimeSecretField
                v-model="secrets.clientKey"
                v-model:clear="clear.clientKey"
                label="Docker client key"
                :configured="runtime?.spec.type === 'docker' && runtime.spec.tls.clientKeyConfigured"
                clearable
                multiline
              />
            </template>
            <template v-else>
              <RuntimeSecretField
                v-model="secrets.kubeconfig"
                v-model:clear="clear.kubeconfig"
                label="Kubeconfig"
                :configured="runtime?.spec.type === 'kubernetes' && runtime.spec.kubeconfigConfigured"
                clearable
                multiline
              />
              <VTextField v-model="draft.context" label="Kubernetes context (optional)" />
              <VTextField v-model="draft.namespace" label="Namespace" />
              <VTextField v-model="draft.serviceAccount" label="Service account" />
              <VTextField v-model="draft.buildkitImage" label="BuildKit image" />
            </template>
            <VSelect
              v-model="draft.npmRegistryCredentialIds"
              :items="store.npmCredentials"
              item-title="meta.title"
              item-value="id"
              label="npm registry credentials"
              multiple
              chips
            />
            <VSelect
              v-model="draft.containerRegistryCredentialIds"
              :items="store.ociCredentials"
              item-title="meta.title"
              item-value="id"
              label="OCI registry credentials"
              multiple
              chips
            />
          </template>
          <template v-else-if="kind === 'pulumi-state-backend'">
            <VTextField v-model="draft.url" label="Pulumi state backend URL" />
            <RuntimeSecretField
              v-model="secrets.credentials"
              v-model:clear="clear.credentials"
              label="State backend credentials"
              :configured="state?.credentialsConfigured"
              clearable
              multiline
            />
          </template>
          <template v-else>
            <VTextField
              v-model="draft.registryUrl"
              :label="kind === 'npm-registry-credential' ? 'Registry URL (HTTP or HTTPS)' : 'Registry host (optional port)'"
            />
            <template v-if="kind === 'npm-registry-credential'">
              <VTextField
                v-model="draft.scope"
                label="npm scope"
                hint="Leave blank for all packages, or use @scope/"
                persistent-hint
              />
              <RuntimeSecretField
                v-model="secrets.token"
                label="npm token"
                :configured="!!credentialsConfigured"
              />
            </template>
            <template v-else>
              <VTextField
                v-model="draft.username"
                label="Registry username"
                hint="Enter username and password together to replace stored credentials"
                persistent-hint
                autocomplete="off"
              />
              <RuntimeSecretField
                v-model="secrets.password"
                label="Registry password"
                :configured="!!credentialsConfigured"
              />
            </template>
          </template>
        </VForm>
        <template v-if="kind === 'container-runtime' && selected">
          <VBtn :disabled="busy || conflict" @click="preflight">Preflight saved runtime</VBtn>
          <div class="text-caption mt-2">
            Checks use the saved revision, not unsaved form values.
          </div>
          <VAlert
            v-for="(check, index) in checks"
            :key="index"
            :type="check.ok ? 'success' : 'error'"
            class="mt-2"
          >
            {{ check.name }}<span v-if="check.detail">: {{ check.detail }}</span>
          </VAlert>
        </template>
        <VAlert v-if="confirmDelete" type="warning" class="mt-4">
          Delete this setting? Referenced settings cannot be deleted.
          <VBtn color="error" :disabled="busy || conflict" @click="remove">Confirm delete</VBtn>
          <VBtn variant="text" :disabled="busy" @click="confirmDelete = false">Cancel</VBtn>
        </VAlert>
      </VCardText>
      <VCardActions>
        <VBtn
          v-if="selected"
          color="error"
          :disabled="busy || conflict"
          @click="confirmDelete = true"
          >Delete</VBtn
        >
        <VSpacer />
        <VBtn :disabled="busy" @click="visible = false">Close</VBtn>
        <VBtn color="primary" :loading="busy" :disabled="conflict" @click="save">Save</VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>
