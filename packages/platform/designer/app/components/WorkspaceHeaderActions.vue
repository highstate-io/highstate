<script setup lang="ts">
import type { IDockviewHeaderActionsProps } from "dockview-vue"
import type accountHandler from "../../server/api/account.get"
import { LayoutResetButton } from "#layers/core/app/features/main-menu"

const { params } = defineProps<{ params: IDockviewHeaderActionsProps }>()
const workspace = useWorkspaceStore()
const access = useAccess()
const showAccount = ref(false)
const accountOpen = ref(false)
type Account = Awaited<ReturnType<typeof accountHandler>>
const { data: account, refresh } = useFetch<Account | null>("/api/account", { default: () => null })

function updateGroup() {
  showAccount.value = params.group.model.panels.some(
    panel => panel.params?.routeName === "components",
  )
}

let dispose: (() => void) | undefined

onMounted(() => {
  updateGroup()
  const subscription = workspace.dockview?.onDidLayoutChange(updateGroup)
  dispose = () => subscription?.dispose()
})

onUnmounted(() => dispose?.())

watch(
  () => access.authenticated.value,
  authenticated => {
    if (!authenticated) {
      accountOpen.value = false
      account.value = null
    }
  },
)

watch(
  () => access.revision.value,
  () => {
    if (access.authenticated.value) {
      void refresh()
    }
  },
)
</script>

<template>
  <div class="workspace-header-actions">
    <LayoutResetButton :params="params" />
    <VMenu
      v-if="showAccount"
      v-model="accountOpen"
      location="bottom end"
      :close-on-content-click="false"
      offset="8"
    >
      <template #activator="{ props: activatorProps }">
        <VBtn
          v-bind="account && access.authenticated.value ? activatorProps : {}"
          :href="account && access.authenticated.value ? undefined : '/login'"
          variant="text"
          size="small"
          class="account-button text-none"
          :aria-label="account && access.authenticated.value ? `Account: ${account.username}` : 'Sign in'"
        >
          <template #prepend>
            <VAvatar size="22" rounded="sm" color="surface-variant">
              <VImg
                v-if="account?.avatarUrl && access.authenticated.value"
                :src="account.avatarUrl"
                alt="Your avatar"
                eager
                cover
                width="22"
                height="22"
              />
              <VIcon v-else size="18">mdi-account-circle</VIcon>
            </VAvatar>
          </template>
          <span class="account-name"
            >{{ account && access.authenticated.value ? account.username : "Sign in" }}</span
          >
        </VBtn>
      </template>
      <VCard
        v-if="account"
        width="380"
        max-width="calc(100vw - 24px)"
        role="dialog"
        aria-label="Your account"
      >
        <VCardText class="pa-4">
          <div class="d-flex align-center ga-3 mb-4">
            <VAvatar size="52" rounded="sm" color="surface-variant">
              <VImg
                v-if="account.avatarUrl"
                :src="account.avatarUrl"
                alt="Your avatar"
                eager
                cover
                width="52"
                height="52"
              />
              <VIcon v-else>mdi-account</VIcon>
            </VAvatar>
            <div class="account-identity">
              <h2 class="text-h6">{{ account.title }}</h2>
              <div class="text-body-2 text-medium-emphasis">{{ account.username }}</div>
            </div>
          </div>
          <VDivider class="mb-4" />
          <VList bg-color="transparent" density="compact" class="pa-0">
            <VListItem class="px-0" v-if="account.email" title="Email" :subtitle="account.email" />
            <VListItem
              class="px-0"
              title="Authentication"
              :subtitle="account.type === 'local' ? 'Local development' : 'OpenID Connect'"
            />
            <VListItem class="px-0" v-if="account.id" title="User ID" :subtitle="account.id" />
          </VList>
        </VCardText>
        <VCardActions v-if="account.type !== 'local'">
          <VSpacer />
          <form action="/api/auth/logout" method="post">
            <VBtn type="submit" prepend-icon="mdi-logout" color="error">Sign out</VBtn>
          </form>
        </VCardActions>
      </VCard>
    </VMenu>
  </div>
</template>

<style scoped>
.workspace-header-actions {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  height: 100%;
}

.account-button {
  margin-inline: 4px;
  max-width: 180px;
}

.account-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-identity {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
