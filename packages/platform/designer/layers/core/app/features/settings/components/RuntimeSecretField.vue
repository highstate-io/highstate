<script setup lang="ts">
import { VTextarea, VTextField } from "vuetify/components"

defineProps<{ label: string; configured?: boolean; clearable?: boolean; multiline?: boolean }>()
const value = defineModel<string>({ required: true })
const clear = defineModel<boolean>("clear", { default: false })
</script>

<template>
  <div class="mb-3">
    <component
      :is="multiline ? VTextarea : VTextField"
      v-model="value"
      :label="label"
      :type="multiline ? undefined : 'password'"
      :disabled="clear"
      :hint="configured ? 'A value is already stored for this setting. Leave blank to keep it unchanged.' : 'No value is stored for this setting.'"
      persistent-hint
      autocomplete="new-password"
      rows="3"
      variant="outlined"
      density="compact"
    />
    <VCheckbox
      v-if="clearable && configured"
      v-model="clear"
      :label="`Clear stored ${label.toLowerCase()}`"
      density="compact"
      hide-details
    />
  </div>
</template>
