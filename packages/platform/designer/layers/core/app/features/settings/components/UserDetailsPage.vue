<script setup lang="ts">
import type { HumanRoleBindingOption, UserOutput } from "@highstate/backend/shared"
import type { AccessRequirement } from "../../../utils/access-control"
import DetailInfoCard from "./DetailInfoCard.vue"
import DetailPageLayout from "./DetailPageLayout.vue"
import IdTableCell from "./IdTableCell.vue"
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
async function changeBinding(role: HumanRoleBindingOption) {
  access.requireAccess(editRequirements(role))
  saving.value = role.id
  bindingFailure.value = undefined

  try {
    const input = {
      roleId: role.id,
      subject: { type: "user" as const, id: userId },
      granted: !role.granted,
    }

    if (projectId) {
      await $client.projectRoleSettings.setHumanBinding.mutate({ projectId, ...input })
    } else {
      await $client.backendRoleSettings.setHumanBinding.mutate(input)
    }

    await load()
  } catch (error) {
    bindingFailure.value = accessError(error)?.message ?? "The role binding could not be changed."
  } finally {
    saving.value = undefined
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
      <h3>Direct role bindings</h3>
      <p class="text-medium-emphasis">
        These bindings apply only to this realm. Identity-provider group grants and
        deployment-configured administrator grants are managed separately.
      </p>
      <AccessBoundary :requirements="bindingRequirements" title="Role bindings unavailable">
        <AccessNotice
          v-if="bindingFailure"
          :message="bindingFailure"
          title="Role bindings unavailable"
        />
        <VList v-if="roles.length" bg-color="transparent">
          <VListItem
            v-for="role in roles"
            :key="role.id"
            :title="role.meta.title"
            :subtitle="role.meta.description"
            class="mb-2"
          >
            <template #prepend
              ><VIcon :color="role.granted ? 'success' : undefined" class="mr-4"
                >{{ role.granted ? 'mdi-shield-check' : 'mdi-shield-outline' }}</VIcon
              ></template
            >
            <template #append>
              <VBtn
                v-access="editRequirements(role)"
                :color="role.granted ? 'error' : 'primary'"
                variant="text"
                :disabled="!!saving"
                :loading="saving === role.id"
                :aria-label="`${role.granted ? 'Remove' : 'Assign'} ${role.meta.title}`"
                @click="changeBinding(role)"
                >{{ role.granted ? 'Remove' : 'Assign' }}</VBtn
              >
            </template>
          </VListItem>
        </VList>
        <p v-else-if="!loading && !bindingFailure" class="text-medium-emphasis">
          No visible roles in this realm.
        </p>
      </AccessBoundary>
    </DetailPageLayout>
  </div>
</template>

<style scoped>
.user-details :deep(.table-container > *) {
  flex-shrink: 0;
}
.user-details :deep(.v-list) {
  overflow: visible;
}
</style>
