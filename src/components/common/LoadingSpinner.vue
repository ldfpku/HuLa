<template>
  <div data-tauri-drag-region class="flex-col-center gap-30px size-full">
    <n-flex vertical justify="center" :size="20">
      <div class="logo-container">
        <img src="/hula.png" class="logo-image" alt="SMJ" loading="eager" />
      </div>
      <n-progress
        type="line"
        :show-indicator="false"
        :color="'#034fbc'"
        :rail-color="'#034fbc30'"
        :percentage="percentage" />
      <n-flex justify="center" align="center" :gap="12">
        <n-spin :size="12" :color="'#034fbc'" />
        <span class="text-14px text-#666">{{ loadingText }}</span>
      </n-flex>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  percentage: number
  loadingText: string
}>()
</script>

<style scoped>
.logo-container {
  width: 220px;
  height: 104px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 10px;
  overflow: hidden;
}

.logo-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
