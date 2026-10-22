<template>
  <img :src="src" :alt="alt" draggable="false" class="select-none" />
</template>

<script setup lang="ts">
import { ThemeEnum } from '@/enums'
import { useSettingStore } from '@/stores/setting.ts'

/**
 * SMJ 标志（BIS v1.7 B2–B8）。只用交付的 SVG，不拉伸、不淡化、不换色：
 * 浅底用标准双色 color，深底（深色主题或 onDark）用反白双色 reverse。
 * wordmark 主标宽 ≥ 48px，symbol 符号高 ≥ 20px（< 24px 时传 mono 用单色版），signature 签名组合宽 ≥ 110px。
 */
const props = withDefaults(
  defineProps<{
    variant?: 'wordmark' | 'symbol' | 'signature'
    onDark?: boolean
    mono?: boolean
    alt?: string
  }>(),
  { variant: 'wordmark', onDark: undefined, mono: false, alt: '斯米伽 SMJ' }
)

const settingStore = useSettingStore()
const { themes } = storeToRefs(settingStore)

const src = computed(() => {
  const dark = props.onDark ?? themes.value.content === ThemeEnum.DARK
  const tone = props.mono ? (dark ? 'white' : 'blue') : dark ? 'reverse' : 'color'
  return `/brand/smj-${props.variant}-${tone}.svg`
})
</script>
