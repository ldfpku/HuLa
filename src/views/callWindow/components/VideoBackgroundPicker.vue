<template>
  <DefineCircle>
    <div
      class="size-44px rounded-full flex-center cursor-pointer"
      :class="selected !== 'none' ? 'bg-#034fbc hover:bg-#02409a' : 'bg-gray-600 hover:bg-gray-500'">
      <n-spin v-if="loading" :size="16" stroke="#fff" />
      <svg v-else class="size-16px color-#fff">
        <use href="#photo"></use>
      </svg>
    </div>
  </DefineCircle>
  <DefinePanel>
    <div
      data-testid="bg-panel"
      class="w-336px max-w-[calc(100vw-24px)] box-border rounded-8px bg-#1f2733 p-14px text-#fff shadow-lg select-none">
      <div class="text-14px font-medium mb-4px">{{ t('message.call_window.bg_title') }}</div>
      <div class="text-12px text-gray-400 mb-12px">
        {{ supported === false ? t('message.call_window.bg_unsupported') : t('message.call_window.bg_hint') }}
      </div>
      <div class="grid grid-cols-3 gap-8px" :class="{ 'opacity-50 pointer-events-none': supported === false }">
        <div
          v-for="item in options"
          :key="item.id"
          :data-testid="`bg-option-${item.id}`"
          class="relative h-54px rounded-4px overflow-hidden cursor-pointer border-2 flex-center text-12px"
          :class="selected === item.id ? 'border-#034fbc' : 'border-transparent hover:border-gray-500'"
          :style="item.style"
          :title="item.label"
          @click="choose(item.id)">
          <img v-if="item.thumb" :src="item.thumb" class="absolute inset-0 size-full object-cover" alt="" />
          <span
            class="relative z-1 rounded-2px px-6px py-1px"
            :class="item.thumb ? 'bg-black/45 absolute bottom-3px left-3px text-11px' : ''">
            {{ item.label }}
          </span>
        </div>
      </div>
      <div v-if="customImage" class="mt-10px text-12px">
        <span class="cursor-pointer text-#7aa7e8 hover:underline" @click="pickFile">
          {{ t('message.call_window.bg_change') }}
        </span>
      </div>
      <input ref="fileInputRef" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="onFile" />
    </div>
  </DefinePanel>

  <!-- 手机（compact）：按钮在屏幕左侧，跟着按钮弹出会超出屏幕，改为在按钮上方、屏幕水平居中弹出 -->
  <template v-if="compact">
    <div ref="triggerRef" data-testid="bg-toggle" @click="toggleCompact">
      <ReuseCircle />
    </div>
    <n-popover
      trigger="manual"
      placement="top"
      :show-arrow="false"
      raw
      style="padding: 0"
      :show="compactShow"
      :x="compactPoint.x"
      :y="compactPoint.y"
      @clickoutside="onClickOutside">
      <ReusePanel />
    </n-popover>
  </template>
  <n-popover v-else trigger="click" placement="top" :show-arrow="false" raw style="padding: 0" @update:show="onShow">
    <template #trigger>
      <div class="flex-col-x-center gap-8px w-80px" data-testid="bg-toggle">
        <ReuseCircle />
        <div class="text-12px text-gray-400 text-center">{{ t('message.call_window.bg_button') }}</div>
      </div>
    </template>
    <ReusePanel />
  </n-popover>
</template>

<script setup lang="ts">
import { createReusableTemplate } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { BRAND_BACKGROUNDS, useVideoBackgroundStore, type VideoBackgroundId } from '@/stores/videoBackground'
import { preloadSegmenter, VideoBackgroundProcessor } from '@/utils/videoBackground/VideoBackgroundProcessor'

/** compact：手机通话页底部的圆形按钮，不带文字 */
const props = defineProps<{ loading: boolean; compact?: boolean }>()

const { t } = useI18n()
const [DefineCircle, ReuseCircle] = createReusableTemplate()
const [DefinePanel, ReusePanel] = createReusableTemplate()
const store = useVideoBackgroundStore()
const { selected, customImage } = storeToRefs(store)
const fileInputRef = ref<HTMLInputElement>()
const supported = ref<boolean | undefined>(undefined)

const brandLabels: Partial<Record<VideoBackgroundId, string>> = {
  'smj-hook': 'message.call_window.bg_smj_hook',
  'smj-split': 'message.call_window.bg_smj_split',
  'smj-wall': 'message.call_window.bg_smj_wall'
}

const options = computed(() => [
  { id: 'none' as const, label: t('message.call_window.bg_none'), thumb: '', style: { background: '#2c3644' } },
  {
    id: 'blur' as const,
    label: t('message.call_window.bg_blur'),
    thumb: '',
    style: { background: 'linear-gradient(135deg, #5b6b85 0%, #9aa8bd 50%, #4a5a73 100%)' }
  },
  ...BRAND_BACKGROUNDS.map((item) => ({ id: item.id, label: t(brandLabels[item.id]!), thumb: item.src, style: {} })),
  {
    id: 'custom' as const,
    label: customImage.value ? t('message.call_window.bg_custom') : `+ ${t('message.call_window.bg_upload')}`,
    thumb: customImage.value,
    style: { background: '#2c3644' }
  }
])

const onShow = async (show: boolean) => {
  if (!show || supported.value !== undefined) return
  supported.value = await VideoBackgroundProcessor.checkSupport()
  if (supported.value) void preloadSegmenter(store.assetsDir())
}

const triggerRef = ref<HTMLElement>()
const compactShow = ref(false)
const compactPoint = reactive({ x: 0, y: 0 })

const toggleCompact = () => {
  if (!props.compact || !triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  compactPoint.x = window.innerWidth / 2
  compactPoint.y = rect.top - 8
  compactShow.value = !compactShow.value
  void onShow(compactShow.value)
}

const onClickOutside = (event: MouseEvent) => {
  if (!props.compact || triggerRef.value?.contains(event.target as Node)) return
  compactShow.value = false
}

const pickFile = () => fileInputRef.value?.click()

const choose = (id: VideoBackgroundId) => {
  if (id === 'custom' && !customImage.value) {
    pickFile()
    return
  }
  store.select(id)
}

const onFile = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    await store.setCustomImage(file)
  } catch {
    window.$message.error(t('message.call_window.bg_image_invalid'))
  }
}
</script>
