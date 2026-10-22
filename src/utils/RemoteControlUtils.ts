/**
 * 远程控制的纯函数：控制方把画面上的鼠标位置换算成对方屏幕的比例坐标，把按键统一成被控端认识的键名。
 * 键名与 src-tauri/src/desktops/remote_control.rs 的 map_key 对应。
 */

/** 控制方发给被控方的一条输入，被控端原样交给 Rust 的 remote_control_input */
export type RemoteInput =
  | { kind: 'move'; x: number; y: number }
  | { kind: 'button'; button: 'left' | 'right' | 'middle'; down: boolean; x: number; y: number }
  | { kind: 'wheel'; dx: number; dy: number }
  | { kind: 'key'; key: string; down: boolean }
  | { kind: 'text'; text: string }

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * object-contain 的视频在元素里实际占的区域（扣掉上下或左右的黑边）
 * videoWidth/videoHeight 还没有时返回 null
 */
export const containedContentRect = (element: Rect, videoWidth: number, videoHeight: number): Rect | null => {
  if (!videoWidth || !videoHeight || !element.width || !element.height) return null
  const scale = Math.min(element.width / videoWidth, element.height / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return {
    left: element.left + (element.width - width) / 2,
    top: element.top + (element.height - height) / 2,
    width,
    height
  }
}

/** 页面坐标换成画面里 0 到 1 的比例；落在黑边上返回 null */
export const toRatioPoint = (content: Rect, clientX: number, clientY: number) => {
  const x = (clientX - content.left) / content.width
  const y = (clientY - content.top) / content.height
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 }
}

export const mouseButtonName = (button: number): 'left' | 'right' | 'middle' | null => {
  if (button === 0) return 'left'
  if (button === 1) return 'middle'
  if (button === 2) return 'right'
  return null
}

const NAMED_KEYS = new Set([
  'Enter',
  'Backspace',
  'Tab',
  'Escape',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'CapsLock',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
])

// 按物理键位取不带 Shift 的字符，组合键（Ctrl+C 等）和 Shift 符号由被控端系统自己处理
const CODE_CHARS: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: '+',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadDecimal: '.'
}

/**
 * KeyboardEvent 转成被控端键名；输入法组字中的按键、无法识别的键返回 null
 */
export const remoteKeyName = (event: Pick<KeyboardEvent, 'key' | 'code' | 'isComposing'>): string | null => {
  const { key, code } = event
  if (event.isComposing || key === 'Process' || key === 'Dead' || key === 'Unidentified') return null
  if (code === 'Space' || key === ' ') return 'Space'
  if (code === 'NumpadEnter') return 'Enter'
  if (NAMED_KEYS.has(key)) return key
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6)
  if (CODE_CHARS[code]) return CODE_CHARS[code]
  // 其他布局或特殊键：只要是单个可见字符就按字符发送
  if ([...key].length === 1 && key.trim()) return key
  return null
}

/**
 * 滚轮像素换成“行”：大约每 100 像素一格（Chromium 在 Windows 上一格就是 100），
 * 返回本次要发的格数和留到下一次的余数，触摸板的小幅滚动会累积起来
 */
export const wheelSteps = (delta: number, deltaMode: number, carry: number) => {
  const pixels = deltaMode === 1 ? delta * 40 : deltaMode === 2 ? delta * 800 : delta
  const total = carry + pixels
  const steps = Math.trunc(total / 100)
  return { steps: Math.max(-20, Math.min(20, steps)), carry: total - steps * 100 }
}

/** 共享画面和主屏的宽高比是否一致，不一致说明共享的不是主屏（多显示器） */
export const sameAspect = (a: { width: number; height: number }, b: { width: number; height: number }) => {
  if (!a.width || !a.height || !b.width || !b.height) return true
  const ra = a.width / a.height
  const rb = b.width / b.height
  return Math.abs(ra - rb) / rb < 0.03
}
