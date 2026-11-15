<script setup lang="ts">
const {
  message,
  title = "Access unavailable",
  panel = false,
  fallback = false,
} = defineProps<{ message: string; title?: string; fallback?: boolean; panel?: boolean }>()
const access = useAccess()
const explanation = computed(() => message.split(/\s+(?=Required permission:)/))
const heading = computed(() =>
  panel &&
  (title === "Access unavailable" ||
    message.includes("Required permission:") ||
    message.startsWith("You do not have permission"))
    ? "Access denied"
    : title,
)
watch(
  [() => message, () => access.rejection.value],
  () => {
    if (!fallback) {
      access.explain(message)
    }
  },
  { immediate: true },
)
</script>

<template>
  <section class="access-notice" :class="{ 'access-notice-panel': panel }" role="alert">
    <VIcon :color="panel ? undefined : 'warning'" size="28">mdi-lock-outline</VIcon>
    <div>
      <h3>{{ heading }}</h3>
      <p>
        <template v-for="(line, index) in explanation" :key="index">
          <br v-if="index" />{{ line }}
        </template>
      </p>
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
.access-notice-panel {
  width: 100%;
  height: 100%;
  min-height: 160px;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
}
.access-notice-panel h3 {
  text-transform: uppercase;
  font-size: 16px;
  font-weight: 400;
}
.access-notice-panel p {
  max-width: 480px;
  font-size: 14px;
}
</style>
