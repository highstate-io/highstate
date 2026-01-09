<script setup lang="ts">
import { Decrypter, webauthn } from "age-encryption"
import { PasswordField } from "#layers/core/app/features/shared"

const { projectId } = defineProps<{
  projectId: string
  canUnlock?: boolean
}>()

const passwordField = useTemplateRef("passwordField")

const password = ref<string>("")
const error = ref<string | null>(null)
const loading = ref(false)

const stateStore = await useProjectStateStore.async(projectId)
const workspaceStore = useWorkspaceStore()

const passKeyInProgress = ref(false)

const tryPassKeyUnlock = async () => {
  if (passKeyInProgress.value) {
    return
  }

  passKeyInProgress.value = true

  const decrypter = new Decrypter()
  decrypter.addIdentity(new webauthn.WebAuthnIdentity())

  try {
    await stateStore.unlock(decrypter)
  } catch (err) {
    globalLogger.error({ error: err }, "failed to unlock project with passkey")
    error.value = "An error occurred while unlocking the project with passkey"
  } finally {
    passKeyInProgress.value = false
  }
}

const unlockState = await until(() => stateStore.unlockState).not.toBeUndefined()

if (
  unlockState.type === "locked" &&
  unlockState.unlockSuite?.hasPasskey &&
  workspaceStore.dockview?.activePanel?.params?.projectId === projectId
) {
  globalLogger.info(`attempting passkey unlock for project "%s"`, projectId)

  void tryPassKeyUnlock()
}

onMounted(() => {
  if (
    passwordField.value &&
    unlockState.type === "locked" &&
    !unlockState.unlockSuite?.hasPasskey
  ) {
    passwordField.value.textField?.focus()
  }
})

watch(password, () => {
  error.value = null
})

const tryPasswordUnlock = async () => {
  loading.value = true
  await nextTick()

  try {
    const decrypter = new Decrypter()
    decrypter.addPassphrase(password.value)

    const unlocked = await stateStore.unlock(decrypter)
    if (!unlocked) {
      error.value = "The password is incorrect"
    }
  } catch (err) {
    globalLogger.error({ error: err }, "failed to unlock project")
    error.value = "An error occurred while unlocking the project"
  } finally {
    loading.value = false
  }
}

const rules = computed(() => [(v: string) => !!v || "Password is required"])
</script>

<template>
  <Suspense v-if="stateStore.unlockState?.type === 'unlocked'">
    <slot />
  </Suspense>

  <div v-else-if="canUnlock && stateStore.isUnlockImpossible" class="password-prompt-container">
    <VCard variant="text">
      <VCardText>
        <VCardTitle class="text-center text-disabled text-uppercase">
          <VIcon color="error">mdi-lock</VIcon>
          <br />
          No unlock method available!
          <br />
          The decryption of state is impossible!
          <br />
          Try to restore the state from backup or ask for help...
        </VCardTitle>

        <div class="text-center mt-4">
          <img src="../../../../../../app/assets/hira-unlock-impossible.png" class="mascot-image" />
        </div>
      </VCardText>
    </VCard>
  </div>

  <div v-else-if="canUnlock" class="password-prompt-container">
    <VCard width="460" variant="text">
      <VCardText>
        <VCardTitle class="text-center text-disabled text-uppercase">
          <VIcon>mdi-lock</VIcon>
          The project is locked
        </VCardTitle>

        <PasswordField
          ref="passwordField"
          v-model="password"
          class="mt-4"
          label="Password"
          hint="Enter the password to unlock the project"
          persistent-hint
          :rules="rules"
          :error-messages="error ? [error] : []"
          @keydown.enter="tryPasswordUnlock"
        />
      </VCardText>

      <VCardActions>
        <VSpacer />
        <VBtn
          v-if="unlockState.type === 'locked' && unlockState.unlockSuite?.hasPasskey"
          color="secondary"
          :loading="passKeyInProgress"
          :disabled="passKeyInProgress"
          @click="tryPassKeyUnlock"
        >
          <VIcon>mdi-fingerprint</VIcon>
        </VBtn>
        <VBtn color="primary" :loading="loading" :disabled="loading" @click="tryPasswordUnlock">
          <VIcon class="mr-2">mdi-lock-open</VIcon>
          Unlock
        </VBtn>
      </VCardActions>
    </VCard>
  </div>

  <div v-else class="mt-4 text-center text-uppercase text-disabled">
    <VIcon>mdi-lock</VIcon>
    The project is locked
  </div>
</template>

<style scoped>
.password-prompt-container {
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.mascot-image {
  width: 600px;
  display: block;
  margin: 0 auto;
}
</style>
