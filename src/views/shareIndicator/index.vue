<template>
  <!-- 共享屏幕时屏幕顶部的常驻提示条：由 Rust 在开始共享时创建、停止时关闭，不会被录进共享画面 -->
  <div
    data-tauri-drag-region
    class="w-full h-100vh flex items-center justify-between gap-10px px-14px bg-#12a150 text-#fff text-13px select-none overflow-hidden">
    <div data-tauri-drag-region class="flex items-center gap-8px min-w-0">
      <svg class="size-14px shrink-0 color-#fff">
        <use href="#screen-sharing"></use>
      </svg>
      <span data-tauri-drag-region class="truncate">{{ label }}</span>
    </div>
    <span class="shrink-0 cursor-pointer rounded-full bg-white/20 hover:bg-white/30 px-12px py-3px" @click="stop">
      {{ t('message.call_window.stop_share') }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const route = useRoute()
const label = computed(() =>
  route.query.surface === 'monitor' ? t('message.call_window.sharing_self') : t('message.call_window.sharing_window')
)

// 由通话窗口停止共享，它停止后会收起本窗口
const stop = () => invoke('screen_share_indicator_stop').catch(() => {})
</script>
