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
const projectName = ref("")
const title = ref("")
const description = ref("")
const step = ref(1)
const localOverlayEnabled = ref(true)
const includeStandardLibrary = ref(true)
const unlockMethodValid = ref(false)
const unlockMethodForm = ref<InstanceType<typeof UnlockMethodForm>>()

const unlockMethodData = ref<UnlockMethodFormData>({
  type: "password",
  title: "Default",
  description: "The initial unlock method configured when creating the project.",
  password: "",
  confirmPassword: "",
})

const supportsLocalLibrary = computed(() =>
  runtimeSettings.runtimes.some(
    item =>
      item.id === containerRuntimeId.value && item.systemName === localContainerRuntime.systemName,
  ),
)

const creating = ref(false)
const error = ref<string>()

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

const projectDetailsValid = computed(() =>
  projectIdRules.every(rule => rule(projectName.value) === true),
)

const runtimeValid = computed(
  () =>
    placementLoaded.value &&
    runtimeSettings.runtimes.some(item => item.id === containerRuntimeId.value) &&
    runtimeSettings.stateBackends.some(item => item.id === pulumiStateBackendId.value),
)

const stepInfo = computed(
  () =>
    [
      {
        title: "Project details",
        icon: "mdi-folder-outline",
        description: "Choose a name, title, and description for your project.",
      },
      {
        title: "Runtime",
        icon: "mdi-server",
        description:
          "Choose where operations run, where state is stored, and whether to include local library sources.",
      },
      {
        title: "Unlock method",
        icon: "mdi-lock-outline",
        description:
          "Choose how to unlock your project's encrypted secrets and state. You can add more unlock methods in Settings later.",
      },
    ][step.value - 1]!,
)

const isFormValid = computed(() => {
  return (
    valid.value &&
    unlockMethodValid.value &&
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
        includeStandardLibrary: includeStandardLibrary.value,
      },
    )

    workspaceStore.openProjectPanel(project.id)
    visible.value = false

    // reset form
    projectName.value = ""
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
    unlockMethodForm.value?.resetForm()
    localOverlayEnabled.value = true
    includeStandardLibrary.value = true

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
  <VDialog
    v-model="visible"
    max-width="760"
    height="760"
    max-height="calc(100dvh - 48px)"
    :persistent="creating"
    scrollable
  >
    <VCard title="New project" class="project-setup-card">
      <VForm v-model="valid" class="project-setup-form">
        <div class="project-setup-heading">
          <h3 class="text-subtitle-1 font-weight-medium mb-2">
            <VIcon class="mr-2">{{ stepInfo.icon }}</VIcon>
            {{ stepInfo.title }}
          </h3>
          <p class="text-body-2 text-medium-emphasis">
            {{ stepInfo.description }}
          </p>
        </div>
        <VDivider class="flex-grow-0" />
        <VCardText class="project-setup-content">
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
          </div>
          <div v-show="step === 2">
            <VAlert v-if="placementError" type="error" class="mb-4">
              {{ placementError }}
            </VAlert>
            <VSelect
              v-model="containerRuntimeId"
              :items="runtimeSettings.runtimes"
              item-title="meta.title"
              item-value="id"
              label="Container runtime"
              hint="Runs project operations, terminals, and workers. Choose a runtime configured in Backend settings."
              persistent-hint
              class="mb-4"
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
              hint="Stores Pulumi deployment state. Changing it later does not move existing state."
              persistent-hint
              class="mb-4"
              variant="outlined"
              density="compact"
              :loading="runtimeSettings.loading"
              :disabled="!placementLoaded || projectsStore.loadingCreateProject"
            />

            <VCheckbox
              v-model="includeStandardLibrary"
              label="Add standard library"
              :disabled="creating"
              color="primary"
              hide-details
            />
            <p class="text-caption text-medium-emphasis mt-1 mb-4">
              Start with the backend's configured initial library packages. Clear to start with an
              empty package selection.
            </p>
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

          <div v-show="step === 3">
            <UnlockMethodForm
              ref="unlockMethodForm"
              initial-setup
              :show-type-selector="true"
              :show-description="true"
              :show-display-name="true"
              default-display-name="Default"
              default-description="The initial unlock method configured when creating the project."
              @update:valid="unlockMethodValid = $event"
              @update:form="unlockMethodData = $event"
            />
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
              <VStepperItem :value="1" title="Project" :complete="step > 1" :editable="!creating" />
              <VDivider />
              <VStepperItem
                :value="2"
                title="Runtime"
                :complete="step > 2"
                :editable="!creating && projectDetailsValid"
              />
              <VDivider />
              <VStepperItem
                :value="3"
                title="Unlock Method"
                :editable="!creating && projectDetailsValid && runtimeValid"
              />
            </VStepperHeader>
          </VStepper>
          <VSpacer />
          <VBtn :disabled="creating" @click="visible = false">Cancel</VBtn>
          <VBtn v-if="step > 1" :disabled="creating" @click="step--">Back</VBtn>
          <VBtn
            v-if="step < 3"
            color="primary"
            :disabled="creating || !projectDetailsValid || (step === 2 && !runtimeValid)"
            @click="step++"
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
.project-setup-card {
  height: 100%;
  min-height: 0;
}

.project-setup-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.project-setup-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.project-setup-heading {
  flex-shrink: 0;
  padding: 0 24px 16px;
}

.project-setup-form > .v-card-actions {
  flex-shrink: 0;
}

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
