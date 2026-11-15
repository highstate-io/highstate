<script setup lang="ts">
const {
  message,
  title = "Access unavailable",
  fallback = false,
} = defineProps<{ message: string; title?: string; fallback?: boolean }>()
const access = useAccess()
const notice = useTemplateRef("notice")
const visible = useElementVisibility(notice)
watch(
  [visible, () => message, () => access.rejection.value],
  () => {
    if (!fallback && visible.value) {
      access.explain(message)
    }
  },
  { immediate: true },
)
</script>

<template>
  <section ref="notice" class="access-notice" role="alert">
    <VIcon color="warning" size="28">mdi-lock-outline</VIcon>
    <div>
      <h3>{{ title }}</h3>
      <p>{{ message }}</p>
      <a v-if="!access.authenticated.value" href="/login">Sign in again</a>
    </div>
  </section>
</template>

<style scoped>
.access-notice {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px;
  margin: 12px 0;
  background: rgba(255, 180, 70, 0.08);
  border: 1px solid rgba(255, 180, 70, 0.3);
  border-radius: 8px;
}
p {
  margin: 8px 0;
}
</style>
