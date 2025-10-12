<script setup lang="ts">
import type { UnlockMethodType } from "@highstate/backend/shared"
import { PasswordField } from "#layers/core/app/features/shared"
import { zxcvbn } from "zxcvbn-typescript"

interface PasswordStrengthResult {
  score: number
  level: "very-weak" | "weak" | "fair" | "strong" | "very-strong"
  estimatedCrackTime: string
  recommendations: string[]
  warning?: string
}

interface UnlockMethodFormData {
  type: UnlockMethodType
  title: string
  description: string
  password: string
  confirmPassword: string
}

interface Props {
  showTypeSelector?: boolean
  showDescription?: boolean
  showDisplayName?: boolean
  initialType?: UnlockMethodType
  displayNameLabel?: string
  displayNameHint?: string
  passwordHint?: string
  defaultDisplayName?: string
  defaultDescription?: string
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

const form = reactive<UnlockMethodFormData>({
  type: props.initialType,
  title: "",
  description: "",
  password: "",
  confirmPassword: "",
})

const displayNameRules = computed(() => {
  if (!props.showDisplayName) {
    return [] // No validation when field is hidden
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

const passwordStrength = computed<PasswordStrengthResult | null>(() => {
  if (!form.password) return null

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
}

// Watch for changes and emit updates
watch(valid, newValid => {
  emit("update:valid", newValid)
})

watch(
  form,
  newForm => {
    emit("update:form", { ...newForm })
  },
  { deep: true },
)

// Initialize form with default values
onMounted(() => {
  form.title = props.defaultDisplayName
  form.description = props.defaultDescription
})

// Expose methods for parent components
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
        class="mb-4"
        label="Password"
        :rules="passwordRules"
        :hint="passwordHint"
        persistent-hint
      />

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
          <div v-if="passwordStrength.warning" class="mt-1">
            {{ passwordStrength.warning }}
          </div>
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
        You'll be prompted to create a passkey using your device's biometric authentication or
        security key when you click Create.
      </VAlert>
    </template>
  </VForm>
</template>
