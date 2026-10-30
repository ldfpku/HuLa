<template>
  <!-- 从网盘选一个文件发到当前会话 -->
  <n-modal
    v-model:show="modalShow"
    preset="card"
    :title="t(attach ? 'todo.attachFile' : 'home.chat_header.sidebar.group.files.picker_title')"
    :bordered="false"
    class="w-520px max-w-[calc(100vw-32px)] rounded-8px">
    <n-flex vertical :size="10">
      <!-- 路径 -->
      <n-flex align="center" :size="4" class="text-(13px --text-color) min-h-22px">
        <span
          class="cursor-pointer hover:color-#034fbc"
          :class="{ 'font-bold': !listing?.path.length }"
          @click="open(undefined)">
          {{ t('home.chat_header.sidebar.group.files.my_drive') }}
        </span>
        <template v-for="(crumb, index) in listing?.path ?? []" :key="crumb.id">
          <span class="color-[--text-muted-color]">/</span>
          <span
            class="truncate max-w-140px"
            :class="index === (listing?.path.length ?? 0) - 1 ? 'font-bold' : 'cursor-pointer hover:color-#034fbc'"
            @click="index < (listing?.path.length ?? 0) - 1 && open(crumb.id)">
            {{ crumb.name }}
          </span>
        </template>
      </n-flex>

      <n-scrollbar class="max-h-[min(55vh,420px)]">
        <n-spin :show="loading">
          <div v-if="loadError" role="alert" class="py-20px text-(13px center [--text-color])">
            {{ t('home.chat_header.sidebar.group.files.picker_load_failed') }}
            <n-button text size="small" @click="open(failedParent)">
              {{ t('home.chat_header.sidebar.group.files.picker_retry') }}
            </n-button>
          </div>
          <div v-if="listing && !listing.items.length" class="py-40px text-(13px center [--text-muted-color])">
            {{ t('home.chat_header.sidebar.group.files.drive_empty') }}
          </div>
          <div
            v-for="item in listing?.items ?? []"
            :key="item.id"
            class="flex items-center gap-10px p-[8px_6px] rounded-6px"
            :class="[
              item.kind === 'folder' || item.sendable ? 'cursor-pointer hover:bg-[--bg-msg-hover]' : 'opacity-50',
              selected === item.id ? 'bg-[--bg-msg-hover]' : ''
            ]"
            @click="handleClick(item)"
            @dblclick="item.kind === 'file' && item.sendable && handleSend()">
            <img
              :src="item.kind === 'folder' ? folderIcon : fileIcon(item.name)"
              class="size-28px shrink-0"
              alt=""
              @error="onIconError" />
            <div class="flex-1 min-w-0">
              <p class="truncate text-(13px --text-color)" :title="item.name">{{ item.name }}</p>
              <p v-if="item.kind === 'file'" class="text-(12px [--text-muted-color]) mt-2px">
                {{ formatBytes(item.size) }}
                <span v-if="!item.sendable">
                  ·
                  {{
                    t('home.chat_header.sidebar.group.files.too_large', { size: formatBytes(listing?.limitBytes ?? 0) })
                  }}
                </span>
              </p>
            </div>
            <svg v-if="item.kind === 'folder'" class="size-12px color-[--text-muted-color] shrink-0">
              <use href="#right"></use>
            </svg>
          </div>
        </n-spin>
      </n-scrollbar>

      <n-flex justify="end" :size="8">
        <n-button size="small" secondary @click="modalShow = false">{{ t('home.chat_header.modal.cancel') }}</n-button>
        <n-button
          size="small"
          color="#034fbc"
          text-color="#ffffff"
          :disabled="!selected"
          :loading="sending"
          @click="handleSend">
          {{ t(attach ? 'todo.attach' : 'home.chat_header.sidebar.group.files.send') }}
        </n-button>
      </n-flex>
    </n-flex>
  </n-modal>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { DrivePickerItem, DrivePickerListing } from '@/services/types'
import { formatBytes, getFileSuffix } from '@/utils/Formatting'
import { getDriveItems, sendDriveFileToRoom } from '@/utils/ImRequestUtils'

const props = withDefaults(defineProps<{ show: boolean; roomId?: string; attach?: boolean }>(), {
  roomId: '',
  attach: false
})
const emit = defineEmits<{ 'update:show': [value: boolean]; sent: []; selected: [id: string] }>()

const { t } = useI18n()
const listing = ref<DrivePickerListing | null>(null)
const loading = ref(false)
const loadError = ref(false)
const failedParent = ref<string | undefined>()
const sending = ref(false)
const selected = ref<string | null>(null)
let requestSeq = 0

const modalShow = computed({
  get: () => props.show,
  set: (value) => emit('update:show', value)
})

const folderIcon = '/file/folder.svg'
const fileIcon = (name: string) => `/file/${getFileSuffix(name)}.svg`
const onIconError = (event: Event) => {
  const target = event.target as HTMLImageElement
  if (!target.src.endsWith('/file/other.svg')) target.src = '/file/other.svg'
}

const open = async (parentId: string | undefined) => {
  const seq = ++requestSeq
  loading.value = true
  loadError.value = false
  listing.value = null
  selected.value = null
  try {
    const result = await getDriveItems(parentId)
    if (seq === requestSeq) listing.value = result
  } catch (error) {
    if (seq === requestSeq) {
      console.error('[DrivePicker] 获取网盘文件失败:', error)
      failedParent.value = parentId
      loadError.value = true
      window.$message?.error(t('home.chat_header.sidebar.group.files.picker_load_failed'))
    }
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

watch(
  () => props.show,
  (visible) => {
    if (visible) {
      listing.value = null
      void open(undefined)
    } else {
      requestSeq++
      listing.value = null
      selected.value = null
      loading.value = false
      loadError.value = false
      failedParent.value = undefined
      sending.value = false
    }
  }
)

const handleClick = (item: DrivePickerItem) => {
  if (item.kind === 'folder') open(item.id)
  else if (item.sendable) selected.value = item.id
}

const handleSend = async () => {
  if (!selected.value || sending.value) return
  if (props.attach) {
    emit('selected', selected.value)
    modalShow.value = false
    return
  }
  if (!props.roomId) {
    window.$message?.error(t('todo.error'))
    return
  }
  sending.value = true
  const seq = requestSeq
  try {
    await sendDriveFileToRoom({ roomId: props.roomId, driveItemId: selected.value })
    if (seq === requestSeq) {
      modalShow.value = false
      emit('sent')
    }
  } catch (error) {
    console.error('[DrivePicker] 发送网盘文件失败:', error)
    if (seq === requestSeq) window.$message?.error(t('home.chat_header.sidebar.group.files.picker_send_failed'))
  } finally {
    if (seq === requestSeq) sending.value = false
  }
}

onBeforeUnmount(() => {
  requestSeq++
})
</script>
