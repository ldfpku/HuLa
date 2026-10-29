<template>
  <n-dropdown trigger="click" :options="options" @select="handleSelect">
    <button
      class="split-button"
      :title="t('components.actionBar.split.title')"
      :aria-label="t('components.actionBar.split.title')">
      <svg class="size-16px color-[--action-bar-icon-color]" viewBox="0 0 16 16" fill="none" stroke="currentColor">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
        <path d="M8 3v10" />
      </svg>
    </button>
  </n-dropdown>
</template>

<script setup lang="ts">
import { LogicalSize, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { useI18n } from 'vue-i18n'
import { splitWindowRect, type SplitDirection } from '@/utils/SplitWindow'
import { splitWindowState } from '@/utils/SplitWindowState'

const { t } = useI18n()
const appWindow = getCurrentWindow()
const options = computed(() => [
  { label: t('components.actionBar.split.left'), key: 'left' },
  { label: t('components.actionBar.split.right'), key: 'right' },
  { label: t('components.actionBar.split.top'), key: 'top' },
  { label: t('components.actionBar.split.bottom'), key: 'bottom' },
  { label: t('components.actionBar.split.restore'), key: 'restore' }
])
let busy = false

const restore = async () => {
  const saved = splitWindowState.saved
  if (!saved) return
  await appWindow.setMinSize(new LogicalSize(330, 480))
  await appWindow.setSize(saved.size)
  await appWindow.setPosition(saved.position)
  if (saved.fullscreen) await appWindow.setFullscreen(true)
  else if (saved.maximized) await appWindow.maximize()
  splitWindowState.saved = undefined
}

const handleSelect = async (direction: SplitDirection | 'restore') => {
  if (busy) return
  busy = true
  try {
    if (direction === 'restore') {
      await restore()
      return
    }
    const monitor = await currentMonitor()
    if (!monitor) throw new Error('Current monitor unavailable')
    const { position, size } = monitor.workArea
    const target = splitWindowRect({ x: position.x, y: position.y, width: size.width, height: size.height }, direction)
    if (target.width < 330 * monitor.scaleFactor || target.height < 200 * monitor.scaleFactor) {
      throw new Error('Work area is too small')
    }
    if (!splitWindowState.saved) {
      splitWindowState.saved = {
        position: await appWindow.outerPosition(),
        size: await appWindow.innerSize(),
        maximized: await appWindow.isMaximized(),
        fullscreen: await appWindow.isFullscreen()
      }
    }
    if (await appWindow.isFullscreen()) await appWindow.setFullscreen(false)
    if (await appWindow.isMaximized()) await appWindow.unmaximize()
    await appWindow.setMinSize(new LogicalSize(330, 200))
    const outer = await appWindow.outerSize()
    const inner = await appWindow.innerSize()
    const width = target.width - Math.max(0, outer.width - inner.width)
    const height = target.height - Math.max(0, outer.height - inner.height)
    if (width < 330 * monitor.scaleFactor || height < 200 * monitor.scaleFactor) {
      throw new Error('Work area is too small')
    }
    await appWindow.setSize(new PhysicalSize(width, height))
    await appWindow.setPosition(new PhysicalPosition(target.x, target.y))
    await new Promise((resolve) => setTimeout(resolve, 200))
    const actual = await appWindow.outerPosition()
    const actualSize = await appWindow.outerSize()
    const tolerance = 30 * monitor.scaleFactor
    if (
      Math.abs(actual.x - target.x) > tolerance ||
      Math.abs(actual.y - target.y) > tolerance ||
      Math.abs(actualSize.width - target.width) > tolerance ||
      Math.abs(actualSize.height - target.height) > tolerance
    ) {
      throw new Error('Window positioning is not supported by the window manager')
    }
  } catch (error) {
    console.error('分屏失败:', error)
    window.$message.warning(t('components.actionBar.split.unsupported'))
    try {
      await restore()
    } catch (restoreError) {
      console.error('恢复窗口失败:', restoreError)
    }
  } finally {
    busy = false
  }
}
</script>

<style scoped>
.split-button {
  width: 28px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.split-button:hover {
  background: var(--icon-hover-color);
}
</style>
