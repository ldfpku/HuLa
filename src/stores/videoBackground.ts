import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import type { BackgroundEffect } from '@/utils/videoBackground/VideoBackgroundProcessor'

export type VideoBackgroundId = 'none' | 'blur' | 'smj-hook' | 'smj-split' | 'smj-wall' | 'custom'

const assetsBase = `${import.meta.env.BASE_URL}video-bg/`

/** 随包的 SMJ 品牌背景 */
export const BRAND_BACKGROUNDS: { id: VideoBackgroundId; src: string }[] = [
  { id: 'smj-hook', src: `${assetsBase}backgrounds/smj-hook.png` },
  { id: 'smj-split', src: `${assetsBase}backgrounds/smj-split.png` },
  { id: 'smj-wall', src: `${assetsBase}backgrounds/smj-wall.jpg` }
]

/** 自定义图片缩到这个尺寸以内再保存，避免撑满本地存储 */
const CUSTOM_MAX_WIDTH = 1280
const CUSTOM_MAX_HEIGHT = 720

const readImageFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, CUSTOM_MAX_WIDTH / image.naturalWidth, CUSTOM_MAX_HEIGHT / image.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(image.naturalWidth * scale)
      canvas.height = Math.round(image.naturalHeight * scale)
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片无法读取'))
    }
    image.src = url
  })

/** 视频通话的背景选择，按本机记住 */
export const useVideoBackgroundStore = defineStore(StoresEnum.VIDEO_BACKGROUND, () => {
  const selected = ref<VideoBackgroundId>('none')
  const customImage = ref('')

  const assetsDir = () => assetsBase

  /** 把选择换成处理器认识的效果 */
  const effectOf = (id: VideoBackgroundId): BackgroundEffect => {
    if (id === 'blur') return { type: 'blur' }
    if (id === 'custom') return customImage.value ? { type: 'image', src: customImage.value } : { type: 'none' }
    const brand = BRAND_BACKGROUNDS.find((item) => item.id === id)
    return brand ? { type: 'image', src: brand.src } : { type: 'none' }
  }

  const currentEffect = computed(() => effectOf(selected.value))

  const select = (id: VideoBackgroundId) => {
    selected.value = id
  }

  /** 读入用户选的图片并选中它 */
  const setCustomImage = async (file: File) => {
    customImage.value = await readImageFile(file)
    selected.value = 'custom'
  }

  return { selected, customImage, currentEffect, assetsDir, effectOf, select, setCustomImage }
})
