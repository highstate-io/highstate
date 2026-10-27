<script setup lang="ts">
import type { ProjectOutput } from "@highstate/backend/shared"
import { localContainerRuntime } from "@highstate/backend/shared"

const props = defineProps<{ project: ProjectOutput | null }>()
const visible = defineModel<boolean>({ required: true })
const settings = useRuntimeSettingsStore()
const projects = useProjectsStore()
const containerRuntimeId = ref("")
const pulumiStateBackendId = ref("")
const busy = ref(false)
const error = ref("")
const loaded = ref(false)
const saved = ref(false)
const overlay = ref<"preserve" | "enable" | "disable">("preserve")
const selectedRuntime = computed(() =>
  settings.runtimes.find(item => item.id === containerRuntimeId.value),
)
const supportsOverlay = computed(
  () =>
    selectedRuntime.value?.id === localContainerRuntime.id &&
    selectedRuntime.value.spec.type === "docker" &&
    selectedRuntime.value.spec.local,
)

watch(
  () => [visible.value, props.project] as const,
  async () => {
    if (!visible.value || !props.project) return
    containerRuntimeId.value = props.project.containerRuntimeId
    pulumiStateBackendId.value = props.project.pulumiStateBackendId
    overlay.value = "preserve"
    saved.value = false
    await load()
  },
)

async function load() {
  error.value = ""
  loaded.value = false
  busy.value = true
  try {
    await settings.load()
    loaded.value = true
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to load placement options"
  } finally {
    busy.value = false
  }
}

async function save() {
  if (!props.project || !loaded.value || busy.value) return
  busy.value = true
  error.value = ""
  saved.value = false
  try {
    await projects.updatePlacement(props.project.id, {
      containerRuntimeId: containerRuntimeId.value,
      pulumiStateBackendId: pulumiStateBackendId.value,
      localOverlayEnabled: !supportsOverlay.value
        ? false
        : overlay.value === "preserve"
          ? undefined
          : overlay.value === "enable",
    })
    saved.value = true
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "Failed to update project placement"
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <VDialog v-model="visible" max-width="650" :persistent="busy">
    <VCard :title="`Placement: ${project?.meta.title ?? ''}`">
      <VCardText>
        <VAlert v-if="error" type="error" class="mb-4">{{ error }}</VAlert>
        <VBtn v-if="!loaded && !busy" class="mb-4" @click="load">Reload options</VBtn>
        <VAlert v-if="saved" type="success" class="mb-4">Project placement updated.</VAlert>
        <VAlert type="info" class="mb-4">
          Stop operations, terminal sessions, and workers, and clean up runtime workloads before
          changing placement. Existing Pulumi state is not copied to another backend.
        </VAlert>
        <VSelect
          v-model="containerRuntimeId"
          :items="settings.runtimes"
          item-title="meta.title"
          item-value="id"
          label="Container runtime"
          :disabled="busy || !loaded"
        />
        <VSelect
          v-model="pulumiStateBackendId"
          :items="settings.stateBackends"
          item-title="meta.title"
          item-value="id"
          label="Pulumi state backend"
          :disabled="busy || !loaded"
        />
        <VSelect
          v-if="supportsOverlay"
          v-model="overlay"
          :items="[
          { title: 'Preserve current overlay setting', value: 'preserve' },
          { title: 'Enable local library overlay', value: 'enable' },
          { title: 'Disable local library overlay', value: 'disable' },
        ]"
          label="Local library overlay"
          :disabled="busy || !loaded"
        />
        <VAlert v-else type="info"
          >This runtime disables the local library overlay. Returning to local placement does not
          re-enable it automatically.</VAlert
        >
      </VCardText>
      <VCardActions>
        <VSpacer />
        <VBtn :disabled="busy" @click="visible = false">Close</VBtn>
        <VBtn
          color="primary"
          :loading="busy"
          :disabled="!loaded || !selectedRuntime || !settings.stateBackends.some(item => item.id === pulumiStateBackendId)"
          @click="save"
          >Save placement</VBtn
        >
      </VCardActions>
    </VCard>
  </VDialog>
</template>
