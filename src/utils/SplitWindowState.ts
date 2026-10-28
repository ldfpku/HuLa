import type { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'

export const splitWindowState: {
  saved?: { position: PhysicalPosition; size: PhysicalSize; maximized: boolean; fullscreen: boolean }
} = {}
