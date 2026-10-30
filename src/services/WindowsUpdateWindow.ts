import { emitTo, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { primaryMonitor } from '@tauri-apps/api/window'
import { clampSizeToMonitor } from '@/utils/WindowSizing'
import type { WindowsUpdateState } from './WindowsUpdateController'

export const UPDATE_STATE_EVENT = 'smj-update-state'
export const UPDATE_QUERY_EVENT = 'smj-update-query'
export const UPDATE_START_EVENT = 'smj-update-start'
export const UPDATE_PREPARE_EVENT = 'smj-update-prepare'
export const UPDATE_PREPARED_EVENT = 'smj-update-prepared'
export const UPDATE_RELEASE_EVENT = 'smj-update-release'

let opening: Promise<WebviewWindow> | null = null

export async function openWindowsUpdate(show: boolean) {
  const existing = await WebviewWindow.getByLabel('update')
  if (existing) {
    if (show) {
      await existing.show()
      await existing.setFocus()
    }
    return existing
  }
  if (!opening) {
    opening = (async () => {
      const { width, height } = clampSizeToMonitor(490, 335, await primaryMonitor())
      return await new Promise<WebviewWindow>((resolve, reject) => {
        const window = new WebviewWindow('update', {
          title: 'SMJ',
          url: '/update',
          width,
          height,
          minWidth: width,
          minHeight: height,
          resizable: false,
          center: true,
          visible: show,
          decorations: true
        })
        void window.once('tauri://created', () => resolve(window)).catch(reject)
        void window
          .once('tauri://error', async (event) => {
            try {
              const other = await WebviewWindow.getByLabel('update')
              if (other) resolve(other)
              else reject(new Error(`Unable to create update window: ${String(event.payload)}`))
            } catch (error) {
              reject(error)
            }
          })
          .catch(reject)
      })
    })().finally(() => {
      opening = null
    })
  }
  const window = await opening
  if (show) {
    await window.show()
    await window.setFocus()
  }
  return window
}

export async function publishWindowsUpdateState(state: WindowsUpdateState) {
  for (const label of ['login', 'home']) {
    if (await WebviewWindow.getByLabel(label)) {
      try {
        await emitTo(label, UPDATE_STATE_EVENT, state)
      } catch (error) {
        console.error(`[update] 向 ${label} 发送更新状态失败:`, error)
      }
    }
  }
}

export async function requestWindowsUpdateState() {
  if (await WebviewWindow.getByLabel('update')) {
    await emitTo('update', UPDATE_QUERY_EVENT)
  }
}

export async function retryWindowsUpdateCheck() {
  if (await WebviewWindow.getByLabel('update')) {
    await emitTo('update', UPDATE_START_EVENT)
    await requestWindowsUpdateState()
  }
}

export async function prepareWindowsUpdateInstall(): Promise<() => Promise<void>> {
  if (!(await WebviewWindow.getByLabel('home'))) return async () => {}
  const id = crypto.randomUUID()
  let resolveResponse: () => void = () => {}
  let rejectResponse: (error: Error) => void = () => {}
  const response = new Promise<void>((resolve, reject) => {
    resolveResponse = resolve
    rejectResponse = reject
  })
  const unlisten = await listen<{ id: string; error?: string }>(UPDATE_PREPARED_EVENT, (event) => {
    if (event.payload.id !== id) return
    if (event.payload.error) rejectResponse(new Error(event.payload.error))
    else resolveResponse()
  })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    timeout = setTimeout(() => rejectResponse(new Error('Update preparation timed out')), 30000)
    await emitTo('home', UPDATE_PREPARE_EVENT, { id })
    await response
  } catch (error) {
    try {
      await emitTo('home', UPDATE_RELEASE_EVENT, { id })
    } catch (releaseError) {
      console.error('[update] 取消安装准备失败:', releaseError)
    }
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    unlisten()
  }
  return async () => emitTo('home', UPDATE_RELEASE_EVENT, { id })
}
