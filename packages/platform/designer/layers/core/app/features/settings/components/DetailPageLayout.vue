<template>
  <div class="settings-list-page">
    <div class="table-container">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.settings-list-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 80px);
  padding: 24px;
  gap: 24px;
}

.table-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  gap: 24px;
}

@media (max-width: 1000px) {
  .settings-list-page {
    padding: 16px;
    gap: 16px;
  }

  .table-container {
    gap: 16px;
  }
}
</style>
