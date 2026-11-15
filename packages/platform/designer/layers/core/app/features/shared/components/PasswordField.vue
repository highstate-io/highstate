<script setup lang="ts">
const model = defineModel<string>()
const visible = defineModel<boolean>("visible", { default: false })
const textField = useTemplateRef("textField")

defineExpose({ textField })
</script>

<template>
  <VTextField
    ref="textField"
    v-model="model"
    variant="outlined"
    density="compact"
    :type="visible ? 'text' : 'password'"
  >
    <template #append-inner>
      <slot name="append-inner" />
      <VBtn
        type="button"
        :icon="visible ? 'mdi-eye-off' : 'mdi-eye'"
        variant="text"
        size="24"
        :aria-label="visible ? 'Hide password' : 'Show password'"
        @click="visible = !visible"
      >
        <VIcon size="20">{{ visible ? 'mdi-eye-off' : 'mdi-eye' }}</VIcon>
        <VTooltip activator="parent" location="top"
          >{{ visible ? 'Hide password' : 'Show password' }}</VTooltip
        >
      </VBtn>
    </template>
  </VTextField>
</template>
