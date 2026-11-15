<script setup lang="ts">
import { localContainerRuntime, localPulumiStateBackend } from "@highstate/backend/shared"
import { camelCaseToHumanReadable } from "@highstate/contract"
import { createId } from "@paralleldrive/cuid2"
import {
  createUnlockMethodFromForm,
  UnlockMethodForm,
  type UnlockMethodFormData,
} from "#layers/core/app/features/unlock-methods"

const visible = defineModel<boolean>("visible")

const valid = ref(false)
const unlockMethodValid = ref(false)
const projectName = ref("")
const title = ref("")
const description = ref("")
const step = ref(1)
const localOverlayEnabled = ref(true)
const extraMethods = ref<{ id: string; valid: boolean; data: UnlockMethodFormData }[]>([])

const supportsLocalLibrary = computed(() =>
  runtimeSettings.runtimes.some(
    item =>
      item.id === containerRuntimeId.value && item.systemName === localContainerRuntime.systemName,
  ),
)

function addMethod() {
  extraMethods.value.push({
    id: createId(),
    valid: false,
    data: { type: "password", title: "", description: "", password: "", confirmPassword: "" },
  })
}
const creating = ref(false)
const error = ref<string>()
const unlockMethodForm = ref<InstanceType<typeof UnlockMethodForm>>()

const unlockMethodData = ref<UnlockMethodFormData>({
  type: "password",
  title: "",
  description: "",
  password: "",
  confirmPassword: "",
})

const projectIdRules = [
  (v: string) => !!v || "Name is required",
  (v: string) => (v && v.length <= 64) || "Name must be less than 64 characters",
  (v: string) =>
    /^[a-z0-9-.]+$/.test(v) ||
    "Name must be alphanumeric in lowercase with dashes (-) and dots (.)",
  (v: string) => /^[a-z]/i.test(v) || "Name must start with a letter",
]

const projectsStore = useProjectsStore()
const workspaceStore = useWorkspaceStore()
const runtimeSettings = useRuntimeSettingsStore()
const containerRuntimeId = ref("")
const pulumiStateBackendId = ref("")
const placementError = computed(() => runtimeSettings.error)
const placementLoaded = computed(() => !runtimeSettings.loading && !runtimeSettings.error)

const isFormValid = computed(() => {
  return (
    valid.value &&
    unlockMethodValid.value &&
    extraMethods.value.every(method => method.valid) &&
    placementLoaded.value &&
    runtimeSettings.runtimes.some(item => item.id === containerRuntimeId.value) &&
    runtimeSettings.stateBackends.some(item => item.id === pulumiStateBackendId.value)
  )
})

const createProject = async () => {
  if (!isFormValid.value) {
    return
  }

  creating.value = true
  error.value = undefined

  try {
    const projectId = createId()

    const unlockMethod = await createUnlockMethodFromForm(unlockMethodData.value, {
      id: projectId,
      name: projectName.value,
    })

    const project = await projectsStore.createProject(
      projectId,
      projectName.value,
      { title: title.value, description: description.value },
      unlockMethod,
      {
        containerRuntimeId: containerRuntimeId.value,
        pulumiStateBackendId: pulumiStateBackendId.value,
        localOverlayEnabled: supportsLocalLibrary.value && localOverlayEnabled.value,
      },
      await Promise.all(
        extraMethods.value.map(method =>
          createUnlockMethodFromForm(method.data, { id: projectId, name: projectName.value }),
        ),
      ),
    )

    workspaceStore.openProjectPanel(project.id)
    visible.value = false

    // reset form
    projectName.value = ""
    unlockMethodForm.value?.resetForm()
  } catch (err) {
    globalLogger.error({ error: err }, "failed to create project")
    error.value = err instanceof Error ? err.message : "Failed to create project"
  } finally {
    creating.value = false
  }
}

// reset form when dialog closes
watch(visible, newVisible => {
  if (newVisible) {
    step.value = 1
    description.value = ""
    extraMethods.value = []
    localOverlayEnabled.value = true

    containerRuntimeId.value =
      runtimeSettings.runtimes.find(item => item.systemName === localContainerRuntime.systemName)
        ?.id ?? ""

    pulumiStateBackendId.value =
      runtimeSettings.stateBackends.find(
        item => item.systemName === localPulumiStateBackend.systemName,
      )?.id ?? ""
  }

  if (!newVisible) {
    projectName.value = ""
    unlockMethodForm.value?.resetForm()
  }
})

watch(projectName, newProjectId => {
  title.value = camelCaseToHumanReadable(newProjectId)
})

watch(
  [() => runtimeSettings.runtimes, () => runtimeSettings.stateBackends],
  () => {
    if (!containerRuntimeId.value) {
      containerRuntimeId.value =
        runtimeSettings.runtimes.find(item => item.systemName === localContainerRuntime.systemName)
          ?.id ?? ""
    }

    if (!pulumiStateBackendId.value) {
      pulumiStateBackendId.value =
        runtimeSettings.stateBackends.find(
          item => item.systemName === localPulumiStateBackend.systemName,
        )?.id ?? ""
    }
  },
  { immediate: true },
)
</script>

<template>
  <VDialog v-model="visible" max-width="760" :persistent="creating" scrollable>
    <VCard title="New project">
      <VForm v-model="valid">
        <VCardText>
          <div v-show="step === 1">
            <VTextField
              v-model="projectName"
              class="mb-4"
              variant="outlined"
              density="compact"
              label="Name"
              :rules="projectIdRules"
              placeholder="my-awesome-project"
              hint="Name must be unique across all repositories connected to the same storage"
              persistent-hint
            />

            <VTextField
              v-model="title"
              class="mb-4"
              variant="outlined"
              density="compact"
              label="Title"
              hint="A human-readable title for your project"
              persistent-hint
            />

            <VTextarea
              v-model="description"
              label="Description"
              :hint="descriptionHint"
              persistent-hint
              variant="outlined"
              density="compact"
              rows="2"
              auto-grow
              class="mb-4"
            />

            <VAlert v-if="placementError" type="error" class="mb-4">
              {{ placementError }}
            </VAlert>
            <VSelect
              v-model="containerRuntimeId"
              :items="runtimeSettings.runtimes"
              item-title="meta.title"
              item-value="id"
              label="Container runtime"
              variant="outlined"
              density="compact"
              :loading="runtimeSettings.loading"
              :disabled="!placementLoaded || projectsStore.loadingCreateProject"
            />
            <VSelect
              v-model="pulumiStateBackendId"
              :items="runtimeSettings.stateBackends"
              item-title="meta.title"
              item-value="id"
              label="Pulumi state backend"
              variant="outlined"
              density="compact"
              :loading="runtimeSettings.loading"
              :disabled="!placementLoaded || projectsStore.loadingCreateProject"
            />

            <VCheckbox
              v-model="localOverlayEnabled"
              label="Use local library sources"
              :disabled="!supportsLocalLibrary || creating"
              color="primary"
              hide-details
            />
            <p class="text-caption text-medium-emphasis mt-1">
              {{ supportsLocalLibrary ? 'Include local workspace components alongside packaged libraries.' : 'Local library sources require the system-managed local runtime.' }}
            </p>
          </div>

          <div v-show="step === 2">
            <div class="mb-4">
              <h3 class="text-subtitle-1 font-weight-medium mb-2">
                <VIcon class="mr-2">mdi-lock-outline</VIcon>
                Unlock methods
              </h3>
              <p class="text-body-2 text-medium-emphasis mb-4">
                Configure one or more ways to unlock this project. Each method can independently
                unlock the same encrypted secrets and state.
              </p>
            </div>

            <UnlockMethodForm
              ref="unlockMethodForm"
              initial-setup
              :show-type-selector="true"
              :show-description="false"
              :show-display-name="false"
              display-name-label="Unlock Method Name"
              display-name-hint="A friendly name for your unlock method"
              password-hint="Password must be strong enough to resist offline attacks"
              default-display-name="Default"
              default-description="The initial unlock method configured when creating the project."
              @update:valid="unlockMethodValid = $event"
              @update:form="unlockMethodData = $event"
            />
            <VCard
              v-for="(method, index) in extraMethods"
              :key="method.id"
              variant="outlined"
              class="mt-4"
            >
              <VCardTitle class="d-flex align-center justify-space-between text-subtitle-1">
                Unlock method {{ index + 2 }}
                <VBtn
                  icon="mdi-delete-outline"
                  :aria-label="`Remove unlock method ${index + 2}`"
                  variant="text"
                  size="small"
                  :disabled="creating"
                  @click="extraMethods.splice(index, 1)"
                />
              </VCardTitle>
              <VCardText>
                <UnlockMethodForm
                  initial-setup
                  :show-type-selector="true"
                  :show-description="false"
                  :show-display-name="true"
                  :default-display-name="`Method ${index + 2}`"
                  @update:valid="method.valid = $event"
                  @update:form="method.data = $event"
                />
              </VCardText>
            </VCard>
            <VBtn
              variant="text"
              prepend-icon="mdi-plus"
              class="mt-4"
              :disabled="creating || extraMethods.length >= 19"
              @click="addMethod"
              >Add unlock method</VBtn
            >
          </div>

          <VAlert v-if="error" type="error" density="compact" class="mt-4">{{ error }}</VAlert>
        </VCardText>

        <VCardActions>
          <VStepper
            v-model="step"
            flat
            hide-actions
            density="compact"
            class="project-stepper"
            aria-label="Project setup progress"
          >
            <VStepperHeader>
              <VStepperItem :value="1" title="Project" :complete="step > 1" />
              <VDivider />
              <VStepperItem :value="2" title="Unlock" />
            </VStepperHeader>
          </VStepper>
          <VSpacer />
          <VBtn :disabled="creating" @click="visible = false">Cancel</VBtn>
          <VBtn v-if="step === 2" :disabled="creating" @click="step = 1">Back</VBtn>
          <VBtn
            v-if="step === 1"
            color="primary"
            :disabled="!projectIdRules.every(rule => rule(projectName) === true) || !placementLoaded || !containerRuntimeId || !pulumiStateBackendId"
            @click="step = 2"
            >Next</VBtn
          >
          <VBtn
            v-else
            color="primary"
            :disabled="!isFormValid || creating"
            :loading="creating"
            @click="createProject"
          >
            Create
          </VBtn>
        </VCardActions>
      </VForm>
    </VCard>
  </VDialog>
</template>

<style scoped>
.project-stepper {
  flex: 0 0 auto;
  background: transparent;
}

.project-stepper :deep(.v-stepper-header) {
  box-shadow: none;
  flex-wrap: nowrap;
}

.project-stepper :deep(.v-stepper-header > .v-divider) {
  width: 16px;
  min-width: 16px;
  margin: 0 2px;
}

.project-stepper :deep(.v-stepper-item) {
  padding: 6px;
}

.project-stepper :deep(.v-stepper-item__avatar) {
  width: 20px;
  height: 20px;
  margin-inline-end: 6px;
  font-size: 11px;
}

.project-stepper :deep(.v-stepper-item__title) {
  font-size: 12px;
}
</style>
