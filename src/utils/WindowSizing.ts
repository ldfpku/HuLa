import type { Monitor } from '@tauri-apps/api/window'

const WINDOW_SAFE_PADDING = 32
const MIN_LOGICAL_WIDTH = 320
const MIN_LOGICAL_HEIGHT = 200

export const clampSizeToMonitor = (width: number, height: number, monitor?: Monitor | null) => {
  if (!monitor) return { width, height }

  const scaleFactor = monitor.scaleFactor ?? 1
  const maxLogicalWidth = Math.max(MIN_LOGICAL_WIDTH, monitor.size.width / scaleFactor - WINDOW_SAFE_PADDING)
  const maxLogicalHeight = Math.max(MIN_LOGICAL_HEIGHT, monitor.size.height / scaleFactor - WINDOW_SAFE_PADDING)

  return {
    width: Math.min(width, Math.floor(maxLogicalWidth)),
    height: Math.min(height, Math.floor(maxLogicalHeight))
  }
}
