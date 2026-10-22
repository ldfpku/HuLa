<template>
  <!-- 盖在对方屏幕画面上，接住鼠标键盘并换算成对方屏幕坐标 -->
  <div
    ref="surfaceRef"
    data-testid="rc-surface"
    class="absolute inset-0 outline-none cursor-default"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="releaseAll"
    @pointermove="onPointerMove"
    @wheel.prevent="onWheel"
    @contextmenu.prevent>
    <!-- 隐藏的输入框拿键盘焦点，输入法组字（中文）结束后整段发给对方 -->
    <textarea
      ref="keyboardRef"
      data-testid="rc-keyboard"
      aria-hidden="true"
      tabindex="-1"
      class="absolute left-0 top-0 w-1px h-1px opacity-0 pointer-events-none resize-none"
      @keydown="onKeyDown"
      @keyup="onKeyUp"
      @compositionend="onCompositionEnd"
      @input="onInput"
      @blur="releaseAll"></textarea>
  </div>
</template>

<script setup lang="ts">
import {
  containedContentRect,
  mouseButtonName,
  type RemoteInput,
  remoteKeyName,
  toRatioPoint,
  wheelSteps
} from '@/utils/RemoteControlUtils'

const props = defineProps<{
  /** 显示对方屏幕的 video 元素（object-contain） */
  video?: HTMLVideoElement
}>()

const emit = defineEmits<{
  input: [input: RemoteInput]
}>()

const surfaceRef = ref<HTMLDivElement>()
const keyboardRef = ref<HTMLTextAreaElement>()
const heldKeys = new Set<string>()
const heldButtons = new Set<'left' | 'right' | 'middle'>()
let pendingMove: { x: number; y: number } | null = null
let moveFrame: number | null = null
let wheelCarry = { x: 0, y: 0 }
// 最近一次发出的位置，松开按键时用
let lastPoint = { x: 0.5, y: 0.5 }

const pointFor = (event: { clientX: number; clientY: number }, clamp = false) => {
  const video = props.video
  if (!video) return null
  const content = containedContentRect(video.getBoundingClientRect(), video.videoWidth, video.videoHeight)
  if (!content) return null
  let { clientX, clientY } = event
  if (clamp) {
    clientX = Math.min(Math.max(clientX, content.left), content.left + content.width)
    clientY = Math.min(Math.max(clientY, content.top), content.top + content.height)
  }
  const point = toRatioPoint(content, clientX, clientY)
  if (point) lastPoint = point
  return point
}

const focusKeyboard = () => keyboardRef.value?.focus({ preventScroll: true })

const flushMove = () => {
  moveFrame = null
  if (pendingMove) emit('input', { kind: 'move', ...pendingMove })
  pendingMove = null
}

const onPointerMove = (event: PointerEvent) => {
  const point = pointFor(event, heldButtons.size > 0)
  if (!point) return
  pendingMove = point
  // 每帧最多发一次，避免高回报率鼠标塞满通道
  if (moveFrame === null) moveFrame = requestAnimationFrame(flushMove)
}

const onPointerDown = (event: PointerEvent) => {
  event.preventDefault()
  focusKeyboard()
  const button = mouseButtonName(event.button)
  const point = pointFor(event)
  if (!button || !point) return
  surfaceRef.value?.setPointerCapture?.(event.pointerId)
  heldButtons.add(button)
  emit('input', { kind: 'button', button, down: true, ...point })
}

const onPointerUp = (event: PointerEvent) => {
  const button = mouseButtonName(event.button)
  if (!button || !heldButtons.has(button)) return
  heldButtons.delete(button)
  const point = pointFor(event, true)
  if (!point) return
  emit('input', { kind: 'button', button, down: false, ...point })
}

const onWheel = (event: WheelEvent) => {
  const y = wheelSteps(event.deltaY, event.deltaMode, wheelCarry.y)
  const x = wheelSteps(event.deltaX, event.deltaMode, wheelCarry.x)
  wheelCarry = { x: x.carry, y: y.carry }
  if (x.steps || y.steps) emit('input', { kind: 'wheel', dx: x.steps, dy: y.steps })
}

const onKeyDown = (event: KeyboardEvent) => {
  // 输入法组字时交给输入法，组字结束再整段发送
  if (event.isComposing || event.key === 'Process') return
  event.preventDefault()
  event.stopPropagation()
  const key = remoteKeyName(event)
  if (!key) return
  heldKeys.add(key)
  emit('input', { kind: 'key', key, down: true })
}

const onKeyUp = (event: KeyboardEvent) => {
  if (event.isComposing) return
  event.preventDefault()
  event.stopPropagation()
  const key = remoteKeyName(event)
  if (!key || !heldKeys.has(key)) return
  heldKeys.delete(key)
  emit('input', { kind: 'key', key, down: false })
}

const onCompositionEnd = (event: CompositionEvent) => {
  if (event.data) emit('input', { kind: 'text', text: event.data })
  if (keyboardRef.value) keyboardRef.value.value = ''
}

const onInput = (event: Event) => {
  if ((event as InputEvent).isComposing) return
  if (keyboardRef.value) keyboardRef.value.value = ''
}

/** 失去焦点、画面切走时松开所有按着的键，避免对方电脑卡在按下状态 */
const releaseAll = () => {
  heldKeys.forEach((key) => emit('input', { kind: 'key', key, down: false }))
  heldKeys.clear()
  heldButtons.forEach((button) => {
    emit('input', { kind: 'button', button, down: false, ...lastPoint })
  })
  heldButtons.clear()
}

onMounted(() => focusKeyboard())

onUnmounted(() => {
  if (moveFrame !== null) cancelAnimationFrame(moveFrame)
  releaseAll()
})

defineExpose({ focusKeyboard })
</script>
