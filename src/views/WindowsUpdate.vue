<template>
  <main class="update-window">
    <header class="update-header" data-tauri-drag-region>
      <BrandLogo variant="signature" class="update-logo" />
    </header>
    <section class="update-content" aria-live="polite">
      <h1>{{ t('message.update_window.title') }}</h1>
      <p v-if="state.version" class="update-version">
        {{ t('message.update_window.version', { version: state.version }) }}
      </p>
      <p class="update-status">{{ t(`message.update_window.stage_${state.stage}`) }}</p>
      <div v-if="state.stage === 'downloading'" class="update-progress">
        <n-spin
          v-if="state.percentage === null"
          size="small"
          :aria-label="t('message.update_window.stage_downloading')" />
        <n-progress
          v-else
          type="line"
          :percentage="state.percentage"
          :aria-label="t('message.update_window.stage_downloading')" />
      </div>
      <p v-if="state.stage === 'ready'" class="update-help">{{ t('message.update_window.ready_help') }}</p>
      <p v-if="state.error || installError" class="update-error" role="alert">
        {{ installError || t(`message.update_window.error_${state.error}`) }}
      </p>
      <div class="update-actions">
        <n-button v-if="state.stage !== 'installing'" secondary @click="hideWindow">
          {{ t(state.stage === 'ready' ? 'message.update_window.later' : 'message.update_window.continue') }}
        </n-button>
        <n-button v-if="state.stage === 'error'" type="primary" @click="retry">
          {{ t('message.update_window.retry') }}
        </n-button>
        <n-button v-if="state.stage === 'ready'" type="primary" @click="install">
          {{ t('message.update_window.restart') }}
        </n-button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { check } from '@tauri-apps/plugin-updater'
import { useI18n } from 'vue-i18n'
import BrandLogo from '@/components/common/BrandLogo.vue'
import { WindowsUpdateController, type WindowsUpdateState } from '@/services/WindowsUpdateController'
import {
  prepareWindowsUpdateInstall,
  publishWindowsUpdateState,
  UPDATE_QUERY_EVENT,
  UPDATE_START_EVENT
} from '@/services/WindowsUpdateWindow'

const { t } = useI18n()
const window = getCurrentWebviewWindow()
const state = ref<WindowsUpdateState>({ stage: 'checking', version: '', percentage: null, error: null })
const installError = ref('')
const unlisteners: UnlistenFn[] = []
let initialized = false
let disposed = false
const controller = new WindowsUpdateController(
  () => check({ timeout: 5000 }),
  (next) => {
    state.value = next
    if (next.stage === 'ready' || next.stage === 'error') {
      void publishWindowsUpdateState(next).catch((error) => console.error('[update] 发送更新状态失败:', error))
    }
  }
)

const hideWindow = async () => {
  try {
    await window.hide()
    await publishWindowsUpdateState(state.value)
  } catch (error) {
    console.error('[update] 隐藏更新窗口失败:', error)
    installError.value = t('message.update_window.stage_error')
  }
}

const retry = async () => {
  installError.value = ''
  await initialize()
}

const install = async () => {
  installError.value = ''
  let release: (() => Promise<void>) | undefined
  try {
    release = await prepareWindowsUpdateInstall()
    await controller.install()
  } catch (error) {
    console.error('[update] 更新交接失败:', error)
    installError.value = release
      ? t('message.update_window.error_install')
      : error instanceof Error && error.message !== 'Update preparation timed out'
        ? error.message
        : t('message.update_window.prepare_failed')
    if (release) {
      try {
        await release()
      } catch (releaseError) {
        console.error('[update] 恢复邮件操作失败:', releaseError)
        installError.value = `${installError.value} ${t('message.update_window.release_failed')}`
      }
    }
  }
}

const initialize = async () => {
  try {
    if (!initialized) {
      const register = async (listener: Promise<UnlistenFn>) => {
        const unlisten = await listener
        if (disposed) unlisten()
        else unlisteners.push(unlisten)
      }
      await register(
        listen(UPDATE_QUERY_EVENT, () => {
          void publishWindowsUpdateState(state.value).catch((error) =>
            console.error('[update] 发送更新状态失败:', error)
          )
        })
      )
      await register(
        listen(UPDATE_START_EVENT, () => {
          void controller.start()
        })
      )
      await register(
        window.onCloseRequested((event) => {
          event.preventDefault()
          void hideWindow()
        })
      )
      if (disposed) return
      initialized = true
    }
    await controller.start()
  } catch (error) {
    console.error('[update] 初始化更新窗口失败:', error)
    for (const unlisten of unlisteners.splice(0)) unlisten()
    initialized = false
    state.value = { ...state.value, stage: 'error', error: 'download' }
    void publishWindowsUpdateState(state.value).catch((publishError) =>
      console.error('[update] 发送更新状态失败:', publishError)
    )
  }
}

onMounted(initialize)

onUnmounted(() => {
  disposed = true
  for (const unlisten of unlisteners) unlisten()
})
</script>

<style scoped lang="scss">
.update-window {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: auto;
  background: var(--bg-popover);
  color: var(--text-color);
  display: flex;
  flex-direction: column;
}

.update-header {
  padding: 22px 28px 0;
}

.update-logo {
  width: 126px;
  height: auto;
}

.update-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 18px 28px 24px;
}

.update-content h1 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
}

.update-version,
.update-status,
.update-help,
.update-error {
  margin: 0 0 8px;
  font-size: 13px;
}

.update-version,
.update-help {
  color: var(--text-muted-color);
}

.update-progress {
  margin: 6px 0 12px;
}

.update-error {
  color: #d03050;
}

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: auto;
}
</style>
