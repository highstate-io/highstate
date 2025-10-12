<script setup lang="ts">
interface DetailInfoItem {
  key: string
  label: string
}

const { title, items } = defineProps<{
  title: string
  items: DetailInfoItem[]
}>()

const slots = defineSlots<{
  [K in `item.${string}`]: () => VNode
}>()
</script>

<template>
  <VCard class="detail-info-card" color="#2d2d2d" bg-color="#1e1e1e" :elevation="0">
    <VCardTitle>{{ title }}</VCardTitle>
    <VCardText>
      <div class="details-grid">
        <div v-for="item in items" :key="item.key" class="detail-item">
          <div class="text-caption text-medium-emphasis mb-1">{{ item.label }}</div>
          <slot :name="`item.${item.key}`">
            <div class="text-body-2 text-medium-emphasis">N/A</div>
          </slot>
        </div>
      </div>
    </VCardText>
  </VCard>
</template>

<style scoped>
.detail-info-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex-shrink: 1;
}

.detail-info-card :deep(.v-card-text) {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px 24px;
  min-width: 0;
}

.detail-item {
  min-height: 60px;
  min-width: 0;
}
</style>
