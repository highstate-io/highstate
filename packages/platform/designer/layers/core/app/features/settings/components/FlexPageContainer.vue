<template>
  <div class="flex-page-container">
    <slot />
  </div>
</template>

<style scoped>
.flex-page-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 0;
  padding: 24px;
  overflow-y: auto;
}

@media (max-width: 1000px) {
  .flex-page-container {
    padding: 16px;
  }
}
</style>