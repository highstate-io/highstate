<script setup lang="ts">
import type { UnlockMethodType } from "@highstate/backend/shared"
import { randomBytes } from "@noble/hashes/utils.js"
import { secureMask } from "micro-key-producer/password.js"
import { zxcvbn } from "zxcvbn-typescript"
import { PasswordField } from "#layers/core/app/features/shared"

type PasswordStrengthResult = {
  score: number
  level: "very-weak" | "weak" | "fair" | "strong" | "very-strong"
  estimatedCrackTime: string
  recommendations: string[]
  warning?: string
}

type UnlockMethodFormData = {
  type: UnlockMethodType
  title: string
  description: string
  password: string
  confirmPassword: string
  autoUnlock?: boolean
}

type Props = {
  showTypeSelector?: boolean
  showDescription?: boolean
  showDisplayName?: boolean
  initialType?: UnlockMethodType
  displayNameLabel?: string
  displayNameHint?: string
  passwordHint?: string
  defaultDisplayName?: string
  defaultDescription?: string
  initialSetup?: boolean
}

interface Emits {
  (e: "update:valid", valid: boolean): void
  (e: "update:form", form: UnlockMethodFormData): void
}

const props = withDefaults(defineProps<Props>(), {
  showTypeSelector: true,
  showDescription: true,
  showDisplayName: true,
  initialType: "password",
  displayNameLabel: "Display Name",
  displayNameHint: "A friendly name to identify this unlock method",
  passwordHint: "Password must be strong enough to resist offline attacks",
  defaultDisplayName: "",
  defaultDescription: "",
})

const emit = defineEmits<Emits>()

const valid = ref(false)
const passwordVisible = ref(false)
const { $client } = useNuxtApp()
const keyringAvailable = ref<boolean>()

const refreshBackendState = async () => {
  keyringAvailable.value = undefined

  try {
    const state = await $client.state.getBackendState.query()
    keyringAvailable.value = state.capabilities.keyring
  } catch {
    keyringAvailable.value = false
  }
}

const form = reactive<UnlockMethodFormData>({
  type: props.initialType,
  title: "",
  description: "",
  password: "",
  confirmPassword: "",
})

const methodValid = computed(
  () => valid.value && (form.type !== "keyring" || keyringAvailable.value === true),
)

watch(
  () => form.type,
  type => {
    if (type === "keyring") {
      void refreshBackendState()
    }
  },
  { immediate: true },
)

const displayNameRules = computed(() => {
  if (!props.showDisplayName) {
    return [] // no validation when field is hidden
  }

  return [
    (v: string) => !!v || "Display name is required",
    (v: string) => (v && v.length <= 100) || "Display name must be less than 100 characters",
  ]
})

const passwordRules = [(v: string) => !!v || "Password is required"]

const confirmPasswordRules = [
  (v: string) => !!v || "Confirm password is required",
  (v: string) => v === form.password || "Passwords do not match",
]

const generatePassword = () => {
  const password = secureMask.apply(randomBytes(32)).password

  form.password = password
  form.confirmPassword = password
  passwordVisible.value = true
}

const passwordStrength = computed<PasswordStrengthResult | null>(() => {
  if (!form.password) {
    return null
  }

  const result = zxcvbn(form.password)

  // convert zxcvbn score (0-4) to our level system
  const levelMap = {
    0: "very-weak" as const,
    1: "weak" as const,
    2: "fair" as const,
    3: "strong" as const,
    4: "very-strong" as const,
  }

  // ensure score is within bounds and cast to key type
  const score = Math.max(0, Math.min(4, result.score)) as keyof typeof levelMap

  return {
    score: (result.score / 4) * 100, // convert 0-4 to 0-100 for progress bar
    level: levelMap[score],
    estimatedCrackTime: result.crack_times_display.offline_slow_hashing_1e4_per_second || "unknown",
    recommendations: result.feedback.suggestions || [],
    warning: result.feedback.warning || undefined,
  }
})

const getStrengthColor = (level: PasswordStrengthResult["level"]) => {
  switch (level) {
    case "very-weak":
      return "error"
    case "weak":
      return "warning"
    case "fair":
      return "info"
    case "strong":
      return "success"
    case "very-strong":
      return "success"
    default:
      return "info"
  }
}

const getTypeIcon = (type: UnlockMethodType) => {
  switch (type) {
    case "password":
      return "mdi-key-variant"
    case "passkey":
      return "mdi-fingerprint"
    case "keyring":
      return "mdi-safe"
    default:
      return "mdi-lock"
  }
}

const resetForm = () => {
  form.type = props.initialType
  form.title = props.defaultDisplayName
  form.description = props.defaultDescription
  form.password = ""
  form.confirmPassword = ""
  passwordVisible.value = false
  form.autoUnlock = false
  keyringAvailable.value = undefined
}

// watch for changes and emit updates
watch(methodValid, newValid => {
  emit("update:valid", newValid)
})

watch(
  form,
  newForm => {
    emit("update:form", { ...newForm })
  },
  { deep: true },
)

// initialize form with default values
onMounted(() => {
  form.title = props.defaultDisplayName
  form.description = props.defaultDescription
})

// expose methods for parent components
defineExpose({
  resetForm,
  form: readonly(form),
})
</script>

<template>
  <VForm v-model="valid">
    <VBtnToggle
      v-if="showTypeSelector"
      v-model="form.type"
      mandatory
      variant="outlined"
      density="compact"
      divided
      class="w-100 mb-6"
    >
      <VBtn value="password" class="flex-grow-1">
        <VIcon :icon="getTypeIcon('password')" class="mr-2" />
        Password
      </VBtn>
      <VBtn value="passkey" class="flex-grow-1">
        <VIcon :icon="getTypeIcon('passkey')" class="mr-2" />
        Passkey
      </VBtn>
      <VBtn value="keyring" class="flex-grow-1">
        <VIcon :icon="getTypeIcon('keyring')" class="mr-2" />
        Keyring
      </VBtn>
    </VBtnToggle>

    <VTextField
      v-if="showDisplayName"
      v-model="form.title"
      class="mb-4"
      variant="outlined"
      density="compact"
      :label="displayNameLabel"
      :rules="displayNameRules"
      placeholder="My unlock method"
      :hint="displayNameHint"
      persistent-hint
    />

    <VTextarea
      v-if="showDescription"
      v-model="form.description"
      class="mb-4"
      variant="outlined"
      density="compact"
      label="Description"
      placeholder="Optional description for this unlock method"
      rows="2"
      auto-grow
      hide-details
    />

    <template v-if="form.type === 'password'">
      <PasswordField
        v-model="form.password"
        v-model:visible="passwordVisible"
        class="mb-4"
        label="Password"
        :rules="passwordRules"
        :hint="passwordHint"
        persistent-hint
      />

      <VBtn
        type="button"
        class="mb-4"
        variant="tonal"
        prepend-icon="mdi-auto-fix"
        @click="generatePassword"
      >
        Generate Secure Password
      </VBtn>

      <PasswordField
        v-model="form.confirmPassword"
        class="mb-4"
        label="Confirm Password"
        :rules="confirmPasswordRules"
      />

      <VAlert
        v-if="passwordStrength && passwordStrength.score < 40"
        :type="passwordStrength.score < 20 ? 'error' : 'warning'"
        density="compact"
        class="mb-4"
      >
        <div class="ml-2">
          <strong>{{ passwordStrength.score < 20 ? "Very Weak" : "Weak" }} Password:</strong>
          <div v-if="passwordStrength.warning" class="mt-1">{{ passwordStrength.warning }}</div>
          <div v-else>
            This password may be vulnerable to offline attacks. Consider using a stronger password.
          </div>
        </div>
      </VAlert>

      <!-- Password Strength Indicator -->
      <div v-if="passwordStrength" class="mb-4">
        <div class="d-flex justify-space-between align-center mb-2">
          <span class="text-caption">Password Strength</span>
          <VChip :color="getStrengthColor(passwordStrength.level)" size="small" variant="flat">
            {{ passwordStrength.level.replace("-", " ").toUpperCase() }}
          </VChip>
        </div>

        <VProgressLinear
          :model-value="passwordStrength.score"
          :color="getStrengthColor(passwordStrength.level)"
          height="6"
          rounded
        />

        <div class="text-caption text-medium-emphasis mt-1">
          Estimated crack time: {{ passwordStrength.estimatedCrackTime }}
        </div>

        <div v-if="passwordStrength.recommendations.length > 0" class="mt-2">
          <div class="text-caption font-weight-medium mb-1">Suggestions:</div>
          <ul class="text-caption text-medium-emphasis ml-4">
            <li v-for="recommendation in passwordStrength.recommendations" :key="recommendation">
              {{ recommendation }}
            </li>
          </ul>
        </div>
      </div>
    </template>

    <template v-else-if="form.type === 'passkey'">
      <VAlert type="info" density="compact" class="mb-4">
        Reuses your Highstate passkey for this domain. If none is returned or you cancel, setup
        opens automatically.
      </VAlert>
    </template>

    <template v-else-if="form.type === 'keyring'">
      <VCheckbox
        v-model="form.autoUnlock"
        label="Automatically unlock on backend startup"
        hide-details
        density="compact"
        class="mb-4"
      />
      <VAlert type="info" density="compact" class="mb-4">
        Uses the backend machine's OS keyring, not your browser's. Its keyring identity is shared
        across projects.
      </VAlert>
      <VAlert v-if="keyringAvailable === false" type="error" density="compact" class="mb-4">
        Keyring unavailable. Unlock or configure the backend's OS secret service.
      </VAlert>
    </template>

    <VAlert type="warning" density="compact" class="mt-4">
      <strong>Recovery risks</strong>
      <p v-if="form.type === 'password'" class="mt-2">
        A forgotten password cannot be recovered. Use a strong, unique password to resist offline
        attacks.
      </p>
      <p v-else-if="form.type === 'passkey'" class="mt-2">
        Loss or compromise of this passkey affects every project using it. Sync is not guaranteed; a
        different domain may require another passkey.
      </p>
      <p v-else class="mt-2">
        Losing the keyring removes this access; anyone able to use it can unlock linked projects.
        Project backups exclude its secret. Add another method before an OS reinstall or backend
        move.
      </p>
      <p class="mt-2">
        <strong v-if="initialSetup"
          >Losing your only unlock method makes project data unrecoverable.</strong
        >
        Keep a recovery method on a separate device or account.
      </p>
    </VAlert>
  </VForm>
</template>
