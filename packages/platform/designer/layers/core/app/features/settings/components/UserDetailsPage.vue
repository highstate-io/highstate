<script setup lang="ts">
import type { HumanRoleBindingOption, UserOutput } from "@highstate/backend/shared"
import type { AccessRequirement } from "../../../utils/access-control"
import DetailInfoCard from "./DetailInfoCard.vue"
import DetailPageLayout from "./DetailPageLayout.vue"
import IdTableCell from "./IdTableCell.vue"
import RelatedDataPanel from "./RelatedDataPanel.vue"
import SettingsPageHeader from "./SettingsPageHeader.vue"
import TimeTableCell from "./TimeTableCell.vue"

const { projectId, userId } = defineProps<{ projectId?: string; userId: string }>()
const { $client } = useNuxtApp()
const access = useAccess()
const user = shallowRef<UserOutput | null>()
const roles = shallowRef<HumanRoleBindingOption[]>([])
const failure = ref<string>()
const bindingFailure = ref<string>()
const loading = ref(false)
const saving = ref<string>()
const selectedRoleIds = ref<string[]>([])
const boundRoles = computed(() => roles.value.filter(role => role.granted))
const availableRoles = computed(() => roles.value.filter(role => !role.granted))
const selectedRoles = computed(() =>
  availableRoles.value.filter(role => selectedRoleIds.value.includes(role.id)),
)
const addRequirements = computed(() => selectedRoles.value.flatMap(editRequirements))
const userAllowed = computed(() => access.status({ permission: "user.get", projectId }).allowed)
const bindingRequirements: AccessRequirement[] = [
  { permission: "user.get", projectId },
  { permission: "role-binding.list", projectId },
  { permission: "role.list", projectId, collection: true },
]
const bindingsAllowed = computed(() => access.status(bindingRequirements).allowed)
let generation = 0
async function load() {
  const current = ++generation

  if (!userAllowed.value) {
    user.value = undefined
    roles.value = []
    return
  }

  loading.value = true
  failure.value = undefined
  bindingFailure.value = undefined

  try {
    const result = projectId
      ? await $client.projectUserSettings.get.query({ projectId, userId })
      : await $client.backendUserSettings.get.query({ userId })

    if (current !== generation || !userAllowed.value) {
      return
    }

    user.value = result

    if (!bindingsAllowed.value) {
      roles.value = []
      return
    }

    try {
      const bindings = projectId
        ? await $client.projectUserSettings.roleBindings.query({ projectId, userId })
        : await $client.backendUserSettings.roleBindings.query({ userId })

      if (current === generation && bindingsAllowed.value) {
        roles.value = bindings
      }
    } catch (error) {
      if (current === generation) {
        roles.value = []
        bindingFailure.value = accessError(error)?.message ?? "Role bindings could not be loaded."
      }
    }
  } catch (error) {
    if (current === generation) {
      user.value = undefined
      roles.value = []
      failure.value = accessError(error)?.message ?? "The user could not be loaded."
    }
  } finally {
    if (current === generation) {
      loading.value = false
    }
  }
}
watch(
  [userAllowed, bindingsAllowed, () => access.revision.value],
  () => {
    void load()
  },
  { immediate: true },
)
useUsersRevision(
  projectId,
  userId,
  userAllowed,
  () => {
    void load()
  },
  bindingsAllowed,
)
const editRequirements = (role: HumanRoleBindingOption): AccessRequirement[] => [
  { permission: "role.update", projectId, target: { resourceId: role.id } },
  ...(role.requiresEscalation
    ? [{ permission: "role.escalate" as const, projectId, target: { resourceId: role.id } }]
    : []),
]
async function changeBinding(role: HumanRoleBindingOption, granted = false) {
  saving.value = role.id
  bindingFailure.value = undefined

  try {
    access.requireAccess(editRequirements(role))

    const input = {
      roleId: role.id,
      subject: { type: "user" as const, id: userId },
      granted,
    }

    if (projectId) {
      await $client.projectRoleSettings.setHumanBinding.mutate({ projectId, ...input })
    } else {
      await $client.backendRoleSettings.setHumanBinding.mutate(input)
    }

    await load()
    return true
  } catch (error) {
    bindingFailure.value = accessError(error)?.message ?? "The role binding could not be changed."
  } finally {
    saving.value = undefined
  }
}
async function addBindings() {
  access.requireAccess(addRequirements.value)

  for (const role of [...selectedRoles.value]) {
    if (!(await changeBinding(role, true))) {
      break
    }

    selectedRoleIds.value = selectedRoleIds.value.filter(id => id !== role.id)
  }
}
const details = [
  { key: "id", label: "User ID" },
  { key: "email", label: "Email" },
  { key: "username", label: "Username" },
  { key: "type", label: "Authentication" },
  { key: "createdAt", label: "Known since" },
]
</script>

<template>
  <div class="h-100">
    <AccessNotice v-if="failure" panel title="User unavailable" :message="failure" />
    <div
      v-else-if="loading && !user"
      class="d-flex align-center justify-center h-100"
      role="status"
    >
      Loading user…
    </div>
    <div v-else-if="user === null" class="d-flex align-center justify-center h-100">
      User not found
    </div>
    <DetailPageLayout v-else-if="user" class="user-details">
      <SettingsPageHeader
        :meta="user.meta"
        :title="user.meta.title"
        :description="projectId ? 'Project user access' : 'Backend user access'"
        fallback-icon="mdi-account"
      />
      <DetailInfoCard title="User details" :items="details">
        <template #item.id><IdTableCell :value="user.id" /></template>
        <template #item.email>{{ user.meta.email ?? '—' }}</template>
        <template #item.username>{{ user.meta.username ?? '—' }}</template>
        <template #item.type
          >{{ user.type === 'oidc' ? 'OIDC' : user.type === 'oauth' ? 'OAuth' : 'Local' }}</template
        >
        <template #item.createdAt><TimeTableCell :value="user.createdAt" /></template>
      </DetailInfoCard>
      <VExpansionPanels :elevation="0">
        <RelatedDataPanel title="Roles" icon="mdi-shield-account" :count="boundRoles.length">
          <div class="pa-4">
            <p class="text-medium-emphasis mb-4">
              These bindings apply only to this realm. Identity-provider group grants and
              deployment-configured administrator grants are managed separately.
            </p>
            <AccessBoundary :requirements="bindingRequirements" title="Role bindings unavailable">
              <AccessNotice
                v-if="bindingFailure"
                :message="bindingFailure"
                title="Role bindings unavailable"
              />
              <div class="binding-form mb-6">
                <VSelect
                  v-model="selectedRoleIds"
                  :items="availableRoles"
                  item-title="meta.title"
                  item-value="id"
                  :item-props="role => ({ disabled: !access.status(editRequirements(role)).allowed })"
                  label="Roles"
                  multiple
                  chips
                  closable-chips
                  density="compact"
                  variant="outlined"
                  hide-details
                  :disabled="(loading && !roles.length) || !!saving"
                >
                  <template #item="{ props, item }">
                    <VListItem v-bind="props" v-access="editRequirements(item.raw)">
                      <template #prepend>
                        <VCheckboxBtn
                          :model-value="selectedRoleIds.includes(item.raw.id)"
                          :ripple="false"
                          tabindex="-1"
                        />
                      </template>
                    </VListItem>
                  </template>
                </VSelect>
                <VBtn
                  v-access="addRequirements"
                  color="primary"
                  class="binding-action"
                  :disabled="loading || !!saving || !selectedRoles.length"
                  :loading="!!saving"
                  @click="addBindings"
                  >Add</VBtn
                >
              </div>
              <VTable>
                <thead>
                  <tr>
                    <th>Role</th>
                    <th class="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="role in boundRoles" :key="role.id">
                    <td>{{ role.meta.title }}</td>
                    <td class="text-right">
                      <VBtn
                        v-access="editRequirements(role)"
                        icon="mdi-delete-outline"
                        variant="text"
                        size="small"
                        :disabled="!!saving"
                        :loading="saving === role.id"
                        :aria-label="`Remove ${role.meta.title}`"
                        @click="changeBinding(role)"
                      />
                    </td>
                  </tr>
                  <tr v-if="!loading && !boundRoles.length">
                    <td colspan="2" class="text-center text-medium-emphasis py-4">No roles</td>
                  </tr>
                </tbody>
              </VTable>
            </AccessBoundary>
          </div>
        </RelatedDataPanel>
      </VExpansionPanels>
    </DetailPageLayout>
  </div>
</template>

<style scoped>
.user-details :deep(.table-container > *) {
  flex-shrink: 0;
}
.binding-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}
.binding-action {
  min-height: 40px;
}
@media (max-width: 600px) {
  .binding-form {
    grid-template-columns: 1fr;
  }
}
</style>
