/**
 * 通话提示音（随包，public/sound/，由 scripts/generate-call-tones.mjs 合成）。
 * 网页构建会把 '/sound/...' 改成带 /im/ 前缀的地址（vite.config.ts 的 smj-web-public-paths）。
 */
export type CallTone = 'incoming' | 'ringback' | 'busy' | 'ended'

export const CALL_TONE_URLS: Record<CallTone, string> = {
  incoming: '/sound/smj-call-incoming.mp3',
  ringback: '/sound/smj-call-ringback.mp3',
  busy: '/sound/smj-call-busy.mp3',
  ended: '/sound/smj-call-ended.mp3'
}

/** 被叫方响来电铃声，主叫方听回铃 */
export const callBellTone = (isReceiver: boolean): CallTone => (isReceiver ? 'incoming' : 'ringback')

/** 单次提示音最多等这么久就继续关窗口，文件加载慢也不拖住挂断 */
export const CALL_CUE_MAX_MS = 1500

const GESTURES = ['pointerdown', 'keydown'] as const

/**
 * 循环铃声。页面还没有用户交互时浏览器会拒绝自动播放，这时等用户第一次点击或按键再响；
 * 期间若已停铃（接听、挂断、关扬声器）就不再补响。
 */
export const createCallBell = (tone: CallTone) => {
  const audio = new Audio(CALL_TONE_URLS[tone])
  audio.loop = true
  let wanted = false
  const detach = () => {
    for (const type of GESTURES) window.removeEventListener(type, retry, true)
  }
  const retry = () => {
    detach()
    if (wanted) audio.play().catch(() => null)
  }
  return {
    play() {
      wanted = true
      audio.play().catch(() => {
        if (!wanted) return
        detach()
        for (const type of GESTURES) window.addEventListener(type, retry, true)
      })
    },
    pause() {
      wanted = false
      detach()
      audio.pause()
    }
  }
}

export type CallBell = ReturnType<typeof createCallBell>

/** 单次提示音（忙线、通话结束），播完或最多 CALL_CUE_MAX_MS 后返回；播放被拒时立即返回 */
export const playCallCue = (tone: CallTone): Promise<void> =>
  new Promise((resolve) => {
    const audio = new Audio(CALL_TONE_URLS[tone])
    const timer = setTimeout(done, CALL_CUE_MAX_MS)
    function done() {
      clearTimeout(timer)
      resolve()
    }
    audio.addEventListener('ended', done, { once: true })
    audio.addEventListener('error', done, { once: true })
    audio.play().catch(done)
  })
