<template>
  <div data-tauri-drag-region class="flex-col-center gap-30px size-full">
    <n-flex vertical justify="center" :size="20">
      <div class="logo-container">
        <BrandLogo class="logo-image" />
      </div>
      <n-progress
        type="line"
        :show-indicator="false"
        :color="'#034fbc'"
        :rail-color="'#d2dff6'"
        :percentage="percentage" />
      <n-flex justify="center" align="center" :gap="12">
        <n-spin :size="12" :color="'#034fbc'" />
        <span class="text-14px text-[--chat-text-color]">{{ loadingText }}</span>
      </n-flex>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import BrandLogo from '@/components/common/BrandLogo.vue'
defineProps<{
  percentage: number
  loadingText: string
}>()
</script>

<style scoped>
.logo-container {
  width: 220px;
  height: 96px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 10px;
  overflow: hidden;
}

.logo-image {
  width: 160px;
  height: auto;
  object-fit: contain;
}
</style>
