<template>
  <!-- 被控端屏幕顶部的常驻提示条：由 Rust 在远程控制开始时创建、结束时关闭。
       不设拖动区域：置顶且不抢焦点的窗口在 Windows 上拖动可能卡在拖动状态 -->
  <div
    class="w-full h-100vh flex items-center justify-between gap-10px px-14px bg-#d5304f text-#fff text-13px select-none overflow-hidden">
    <div class="flex items-center gap-8px min-w-0">
      <div class="w-8px h-8px shrink-0 rounded-full bg-#fff animate-pulse"></div>
      <span class="truncate">
        {{ t('message.call_window.rc_being_controlled', { name }) }}
      </span>
      <span v-if="isWindows()" class="shrink-0 opacity-80">{{ t('message.call_window.rc_escape_hint') }}</span>
    </div>
    <span class="shrink-0 cursor-pointer rounded-full bg-white/20 hover:bg-white/30 px-12px py-3px" @click="stop">
      {{ t('message.call_window.rc_stop_control') }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { isWindows } from '@/utils/PlatformConstants'

const { t } = useI18n()
const route = useRoute()
const name = computed(() => String(route.query.name || ''))

// Rust 结束会话后会关闭本窗口，并通知通话窗口告诉对方
const stop = () => invoke('remote_control_stop').catch(() => {})
</script>
