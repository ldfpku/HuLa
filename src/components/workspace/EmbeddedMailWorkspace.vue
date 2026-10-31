<template>
  <section class="flex flex-1 min-w-0 min-h-0 flex-col bg-[--right-bg-color]">
    <ActionBar current-label="home">
      <span class="text-12px text-[--text-color]">邮箱</span>
    </ActionBar>
    <div
      v-if="errorMessage"
      class="flex items-center justify-between gap-12px px-12px py-6px text-12px color-#c53030"
      role="alert">
      <span>{{ errorMessage }}</span>
      <button v-if="retryable" type="button" class="underline" @click="retry">重试</button>
      <button v-else type="button" aria-label="关闭提示" @click="errorMessage = ''">×</button>
    </div>
    <div
      v-if="downloadMessage"
      class="flex items-start justify-between gap-12px bg-blue-50 px-12px py-8px text-13px color-#174ea6"
      role="status">
      <span class="min-w-0 break-all">{{ downloadMessage }}</span>
      <button type="button" aria-label="关闭提示" @click="downloadMessage = ''">×</button>
    </div>
    <div ref="container" class="flex-1 min-h-0 min-w-0" />
  </section>
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import ActionBar from '@/components/windows/ActionBar.vue'
import { EmbeddedMailController, type MailViewBounds } from '@/services/EmbeddedMailController'
import { useUserStore } from '@/stores/user'
import { useWorkspaceStore } from '@/stores/workspace'
import { getMailSsoUrl } from '@/utils/ImRequestUtils'
import { mailBounds, overlapsMail } from '@/utils/MailWorkspaceGeometry'

const props = defineProps<{ blocked: boolean }>()
const workspace = useWorkspaceStore()
const user = useUserStore()
const container = ref<HTMLElement | null>(null)
const bounds = shallowRef<MailViewBounds | null>(null)
const obscured = ref(false)
const errorMessage = ref('')
const downloadMessage = ref('')
const retryable = ref(true)
const pageVisible = ref(!document.hidden)
const account = computed(() => user.userInfo?.uid ?? '')
const active = computed(
  () =>
    workspace.active === 'mail' && !props.blocked && !workspace.sidebarMenuOpen && !obscured.value && pageVisible.value
)

const controller = new EmbeddedMailController({
  requestSso: async (target) => (await getMailSsoUrl(target)).url,
  create: (url, nextBounds, account) => invoke('create_embedded_mail', { url, bounds: nextBounds, account }),
  navigate: (url, account) => invoke('navigate_embedded_mail', { url, account }),
  resize: (nextBounds) => invoke('update_embedded_mail_bounds', { bounds: nextBounds }),
  setVisible: (visible) => invoke('set_embedded_mail_visible', { visible }),
  close: () => invoke('close_embedded_mail'),
  reportError: (error) => {
    console.error('邮件工作区操作失败:', error)
    retryable.value = true
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
})

const retry = async () => {
  errorMessage.value = ''
  try {
    await registerErrorListener()
    if (!disposed) await controller.retry()
  } catch (error) {
    console.error('监听邮件工作区错误失败:', error)
    errorMessage.value = '邮件工作区状态监听失败，请重试'
  }
}

watch(
  [active, account, bounds, () => workspace.mailNavigation],
  ([isActive, uid, nextBounds, navigation]) => {
    void controller.update({ active: isActive, account: uid, bounds: nextBounds, navigation })
  },
  { immediate: true, flush: 'post' }
)

watch([account, () => workspace.mailNavigation?.id], () => {
  errorMessage.value = ''
})

const overlaySelector = '.n-modal-mask, .n-modal-container, .n-popover, .n-dropdown-menu, .n-message, [role="dialog"]'
let frame = 0
let resizeObserver: ResizeObserver | undefined
let mutationObserver: MutationObserver | undefined
let unlisten: UnlistenFn | undefined
let unlistenDownload: UnlistenFn | undefined
let listening: Promise<void> | undefined
let disposed = false

const registerErrorListener = () => {
  if (unlisten || disposed) return Promise.resolve()
  listening ??= (async () => {
    const stopError = await listen<string>('mail-workspace-error', (event) => {
      errorMessage.value = event.payload
      downloadMessage.value = ''
      retryable.value = false
    })
    try {
      const stopDownload = await listen<string>('mail-workspace-download', (event) => {
        downloadMessage.value = event.payload
      })
      if (disposed) {
        stopError()
        stopDownload()
      } else {
        unlisten = stopError
        unlistenDownload = stopDownload
      }
    } catch (error) {
      stopError()
      throw error
    }
  })().finally(() => {
    listening = undefined
  })
  return listening
}

const measure = () => {
  frame = 0
  const element = container.value
  const next = element ? mailBounds(element.getBoundingClientRect(), { width: innerWidth, height: innerHeight }) : null
  const previous = bounds.value
  if (
    next?.x !== previous?.x ||
    next?.y !== previous?.y ||
    next?.width !== previous?.width ||
    next?.height !== previous?.height
  ) {
    bounds.value = next
  }
  obscured.value = Boolean(
    next &&
    [...document.querySelectorAll<HTMLElement>(overlaySelector)].some((overlay) => {
      const style = getComputedStyle(overlay)
      return (
        style.display !== 'none' && style.visibility !== 'hidden' && overlapsMail(next, overlay.getBoundingClientRect())
      )
    })
  )
}

const scheduleMeasure = () => {
  if (!frame) frame = requestAnimationFrame(measure)
}

const visibilityChanged = () => {
  pageVisible.value = !document.hidden
  scheduleMeasure()
}

onMounted(async () => {
  if (container.value) {
    resizeObserver = new ResizeObserver(scheduleMeasure)
    resizeObserver.observe(container.value)
  }
  mutationObserver = new MutationObserver(scheduleMeasure)
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  })
  window.addEventListener('resize', scheduleMeasure)
  document.addEventListener('visibilitychange', visibilityChanged)
  scheduleMeasure()
  try {
    await registerErrorListener()
  } catch (error) {
    console.error('监听邮件工作区错误失败:', error)
    retryable.value = true
    errorMessage.value = '邮件工作区状态监听失败，请重试'
  }
})

onBeforeUnmount(() => {
  disposed = true
  if (frame) cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  window.removeEventListener('resize', scheduleMeasure)
  document.removeEventListener('visibilitychange', visibilityChanged)
  unlisten?.()
  unlistenDownload?.()
  void controller.dispose()
})
</script>
