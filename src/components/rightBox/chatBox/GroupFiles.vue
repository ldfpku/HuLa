<template>
  <!-- 侧栏入口：群里发过的文件，即群在网盘里的文件夹。只有一个根节点才能用上侧栏的 box-item 样式，弹窗会挂到 body 上 -->
  <div class="box-item cursor-pointer" @click="openModal">
    <div class="flex-between-center">
      <p class="text-(14px --text-color)">{{ t('home.chat_header.sidebar.group.files.title') }}</p>
      <n-flex align="center" :size="6">
        <p v-if="total !== null" class="text-(12px [--text-muted-color])">
          {{ t('home.chat_header.sidebar.group.files.count', { count: total }) }}
        </p>
        <svg class="size-12px color-#909090"><use href="#right"></use></svg>
      </n-flex>
    </div>

    <n-modal
      v-model:show="show"
      preset="card"
      :title="t('home.chat_header.sidebar.group.files.title')"
      :bordered="false"
      class="w-560px max-w-[calc(100vw-32px)] rounded-8px">
      <n-flex vertical :size="12">
        <n-flex align="center" :size="8">
          <n-input
            v-model:value="keyword"
            size="small"
            clearable
            class="flex-1"
            spellCheck="false"
            autoComplete="off"
            :placeholder="t('home.chat_header.sidebar.group.files.search')"
            @update:value="onKeywordChange">
            <template #prefix>
              <svg class="size-14px color-#909090"><use href="#search"></use></svg>
            </template>
          </n-input>
          <n-button size="small" color="#034fbc" text-color="#ffffff" @click="showPicker = true">
            {{ t('home.chat_header.sidebar.group.files.send_from_drive') }}
          </n-button>
        </n-flex>

        <p v-if="totalSize !== null && !keyword.trim()" class="text-(12px [--text-muted-color])">
          {{ t('home.chat_header.sidebar.group.files.summary', { count: total ?? 0, size: formatBytes(totalSize) }) }}
        </p>

        <n-scrollbar class="max-h-[min(60vh,480px)]">
          <n-spin :show="loading && !files.length">
            <div v-if="!files.length && !loading" class="py-40px text-(13px center [--text-muted-color])">
              {{
                keyword.trim()
                  ? t('home.chat_header.sidebar.group.files.no_match')
                  : t('home.chat_header.sidebar.group.files.empty')
              }}
            </div>
            <div
              v-for="file in files"
              :key="file.id"
              class="group-file-row flex items-center gap-10px p-[8px_6px] rounded-6px hover:bg-[--bg-msg-hover]">
              <img :src="fileIcon(file.fileName)" class="size-32px shrink-0" alt="" @error="onIconError" />
              <div class="flex-1 min-w-0 cursor-pointer" @click="handlePreview(file)">
                <p class="truncate text-(13px --text-color)" :title="file.fileName">{{ file.fileName }}</p>
                <p class="truncate text-(12px [--text-muted-color]) mt-2px">
                  {{ formatBytes(file.size) }} · {{ file.uploaderName }} · {{ formatTime(file.createdAt) }}
                </p>
              </div>
              <n-flex :size="4" class="shrink-0">
                <n-button quaternary size="tiny" @click="handlePreview(file)">
                  {{ t('home.chat_header.sidebar.group.files.preview') }}
                </n-button>
                <n-button quaternary size="tiny" @click="handleDownload(file)">
                  {{ t('home.chat_header.sidebar.group.files.download') }}
                </n-button>
                <n-dropdown
                  trigger="click"
                  :options="moreOptions(file)"
                  @select="(key: string) => handleMore(key, file)">
                  <n-button
                    :title="t('tooltip.more_actions')"
                    :aria-label="t('tooltip.more_actions')"
                    quaternary
                    size="tiny">
                    <svg class="size-14px"><use href="#more"></use></svg>
                  </n-button>
                </n-dropdown>
              </n-flex>
            </div>
            <n-flex v-if="!isLast && files.length" justify="center" class="py-8px">
              <n-button size="small" quaternary :loading="loading" @click="loadMore">
                {{ t('home.chat_header.sidebar.group.files.more') }}
              </n-button>
            </n-flex>
          </n-spin>
        </n-scrollbar>
      </n-flex>
    </n-modal>

    <DrivePickerModal v-model:show="showPicker" :room-id="roomId" @sent="onSentFromDrive" />
  </div>
</template>

<script setup lang="ts">
import { openUrl } from '@tauri-apps/plugin-opener'
import { useI18n } from 'vue-i18n'
import type { RoomFile } from '@/services/types'
import { formatBytes, getFileSuffix } from '@/utils/Formatting'
import { getRoomFiles, removeRoomFile, saveRoomFileToDrive } from '@/utils/ImRequestUtils'
import { isWeb } from '@/utils/PlatformConstants'
import DrivePickerModal from './DrivePickerModal.vue'

const props = defineProps<{ roomId: string }>()

const { t } = useI18n()
const show = ref(false)
const showPicker = ref(false)
const files = ref<RoomFile[]>([])
const cursor = ref('')
const isLast = ref(true)
const loading = ref(false)
const keyword = ref('')
const total = ref<number | null>(null)
const totalSize = ref<number | null>(null)
let requestSeq = 0
let keywordTimer: ReturnType<typeof setTimeout> | undefined

const fileIcon = (name: string) => `/file/${getFileSuffix(name)}.svg`
const onIconError = (event: Event) => {
  const target = event.target as HTMLImageElement
  if (!target.src.endsWith('/file/other.svg')) target.src = '/file/other.svg'
}

const formatTime = (time: number) => {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return sameYear ? day : `${date.getFullYear()}-${day}`
}

/** 读第一页（reset）或下一页 */
const load = async (reset: boolean) => {
  const roomId = props.roomId
  if (!roomId) return
  const seq = ++requestSeq
  loading.value = true
  try {
    const params: { roomId: string; cursor?: string; pageSize: number; keyword?: string } = { roomId, pageSize: 50 }
    if (!reset && cursor.value) params.cursor = cursor.value
    if (keyword.value.trim()) params.keyword = keyword.value.trim()
    const page = await getRoomFiles(params)
    if (seq !== requestSeq || roomId !== props.roomId) return
    files.value = reset ? page.list : [...files.value, ...page.list]
    cursor.value = page.cursor
    isLast.value = page.isLast
    total.value = page.total
    totalSize.value = page.totalSize
  } catch (error) {
    console.error('[GroupFiles] 获取群文件失败:', error)
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

const loadMore = () => load(false)

const onKeywordChange = () => {
  clearTimeout(keywordTimer)
  keywordTimer = setTimeout(() => load(true), 300)
}

const openModal = () => {
  show.value = true
  load(true)
}

watch(
  () => props.roomId,
  () => {
    files.value = []
    total.value = null
    totalSize.value = null
    keyword.value = ''
    show.value = false
    load(true)
  },
  { immediate: true }
)

onBeforeUnmount(() => clearTimeout(keywordTimer))

const handlePreview = (file: RoomFile) => {
  openUrl(file.url).catch((error) => console.error('[GroupFiles] 打开文件失败:', error))
}

const handleDownload = async (file: RoomFile) => {
  if (!isWeb()) {
    openUrl(file.downloadUrl).catch((error) => console.error('[GroupFiles] 下载文件失败:', error))
    return
  }
  // 网页版先取回文件再交给浏览器保存，文件名才能保持原样；链接不挂到页面上，点击不会被侧栏当成点了外面而关掉
  try {
    const response = await fetch(file.downloadUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const link = document.createElement('a')
    link.href = URL.createObjectURL(await response.blob())
    link.download = file.fileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
  } catch (error) {
    console.error('[GroupFiles] 下载文件失败:', error)
    window.$message?.error(t('home.chat_header.sidebar.group.files.download_failed'))
  }
}

const moreOptions = (file: RoomFile) => [
  { key: 'save', label: t('home.chat_header.sidebar.group.files.save_to_drive') },
  ...(file.canRemove ? [{ key: 'remove', label: t('home.chat_header.sidebar.group.files.remove') }] : [])
]

const handleMore = async (key: string, file: RoomFile) => {
  if (key === 'save') {
    try {
      await saveRoomFileToDrive({ roomId: props.roomId, id: file.id })
      window.$message?.success(t('home.chat_header.sidebar.group.files.saved'))
    } catch (error) {
      console.error('[GroupFiles] 存到网盘失败:', error)
    }
    return
  }
  if (key === 'remove') {
    window.$dialog.warning({
      title: t('home.chat_header.sidebar.group.files.remove'),
      content: t('home.chat_header.sidebar.group.files.confirm_remove', { name: file.fileName }),
      positiveText: t('home.chat_header.sidebar.group.files.remove'),
      negativeText: t('home.chat_header.modal.cancel'),
      onPositiveClick: async () => {
        try {
          await removeRoomFile({ roomId: props.roomId, id: file.id })
          await load(true)
        } catch (error) {
          console.error('[GroupFiles] 移除群文件失败:', error)
        }
      }
    })
  }
}

const onSentFromDrive = () => {
  window.$message?.success(t('home.chat_header.sidebar.group.files.sent'))
  load(true)
}
</script>
