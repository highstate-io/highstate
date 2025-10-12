<script setup lang="ts">
import {
  createUnlockMethodFromForm,
  UnlockMethodForm,
  type UnlockMethodFormData,
} from "#layers/core/app/features/unlock-methods"
import { camelCaseToHumanReadable } from "@highstate/contract"

const visible = defineModel<boolean>("visible")

const valid = ref(false)
const unlockMethodValid = ref(false)
const projectName = ref("")
const title = ref("")
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
    /^[a-z0-9-\.]+$/.test(v) ||
    "Name must be alphanumeric in lowercase with dashes (-) and dots (.)",
  (v: string) => /^[a-z]/i.test(v) || "Name must start with a letter",
]

const projectsStore = useProjectsStore()
const workspaceStore = useWorkspaceStore()

const isFormValid = computed(() => {
  return valid.value && unlockMethodValid.value
})

const createProject = async () => {
  if (!isFormValid.value) return

  const unlockMethod = await createUnlockMethodFromForm(unlockMethodData.value)

  const project = await projectsStore.createProject(
    projectName.value,
    { title: title.value },
    unlockMethod,
  )

  workspaceStore.openProjectPanel(project.id)
  visible.value = false

  // Reset form
  projectName.value = ""
  unlockMethodForm.value?.resetForm()
}

// Reset form when dialog closes
watch(visible, newVisible => {
  if (!newVisible) {
    projectName.value = ""
    unlockMethodForm.value?.resetForm()
  }
})

watch(projectName, newProjectId => {
  title.value = camelCaseToHumanReadable(newProjectId)
})
</script>

<template>
  <VDialog v-model="visible" max-width="600px">
    <VCard title="New project" color="#2d2d2d">
      <VForm v-model="valid">
        <VCardText>
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

          <VDivider class="my-6" />

          <div class="mb-4">
            <h3 class="text-subtitle-1 font-weight-medium mb-2">
              <VIcon class="mr-2">mdi-lock-outline</VIcon>
              Unlock Method
            </h3>
            <p class="text-body-2 text-medium-emphasis mb-4">
              This method will be used to encrypt your project secrets and state data. You can add
              more unlock methods later.
            </p>
          </div>

          <UnlockMethodForm
            ref="unlockMethodForm"
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

          <VAlert type="warning" density="compact" class="mt-4">
            <div class="ml-2">
              <strong>Important:</strong>
              Losing your unlock method will result in losing control over the created resources!
            </div>
          </VAlert>
        </VCardText>

        <VCardActions>
          <VSpacer />
          <VBtn @click="visible = false">Cancel</VBtn>
          <VBtn
            :disabled="!isFormValid"
            :loading="projectsStore.loadingCreateProject"
            @click="createProject"
          >
            Create
          </VBtn>
        </VCardActions>
      </VForm>
    </VCard>
  </VDialog>
</template>
