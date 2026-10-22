<template>
  <!-- 被共享的显示器四周的绿色边框：窗口透明、鼠标穿透、不会被录进共享画面，由 Rust 创建和关闭 -->
  <div class="share-border fixed inset-0 pointer-events-none select-none"></div>
</template>

<script setup lang="ts">
// 全局样式给页面铺了底色，这个窗口要整片透明，只留边框
onMounted(() => {
  for (const el of [document.documentElement, document.body, document.getElementById('app')]) {
    if (el) el.style.background = 'transparent'
  }
})
</script>

<style scoped>
.share-border {
  border: 4px solid var(--share-indicator-color, #12a150);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6);
}
</style>
