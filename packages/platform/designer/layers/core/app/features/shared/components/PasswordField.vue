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
      <VIcon @click="visible = !visible">
        {{ visible ? "mdi-eye-off" : "mdi-eye" }}
      </VIcon>
    </template>
  </VTextField>
</template>
