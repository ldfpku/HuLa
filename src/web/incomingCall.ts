/**
 * 网页版来电提示：来电是服务端推送的，没有用户点击，直接打开通话标签页会被浏览器当弹窗拦掉。
 * 所以在当前页面右下角显示来电横幅，用户点“接听”时再打开通话页（并自动接听），点“拒绝”直接回复拒绝。
 */

import { type CallBell, createCallBell } from '@/utils/CallToneUtils'

const BANNER_ID = 'smj-web-incoming-call'

let bell: CallBell | null = null

export const closeIncomingCall = () => {
  document.getElementById(BANNER_ID)?.remove()
  bell?.pause()
  bell = null
}

type IncomingCall = {
  isVideo: boolean
  callerName?: string
  onAccept: () => void
  onReject: () => void
}

export const showIncomingCall = ({ isVideo, callerName, onAccept, onReject }: IncomingCall) => {
  closeIncomingCall()
  const banner = document.createElement('div')
  banner.id = BANNER_ID
  banner.setAttribute('role', 'alertdialog')
  banner.style.cssText = [
    'position:fixed',
    'right:20px',
    'bottom:20px',
    'z-index:99999',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:14px 16px',
    'border-radius:10px',
    'background:#fff',
    'color:#1f2a44',
    'box-shadow:0 8px 28px rgba(0,0,0,.18)',
    'font:14px/1.4 system-ui,sans-serif'
  ].join(';')
  const text = document.createElement('div')
  const kind = isVideo ? '视频' : '语音'
  text.textContent = callerName ? `${callerName}邀请你${kind}通话` : `收到${kind}通话来电`
  const button = (label: string, color: string, onClick: () => void) => {
    const el = document.createElement('button')
    el.type = 'button'
    el.textContent = label
    el.style.cssText = `border:0;border-radius:6px;padding:6px 14px;color:#fff;cursor:pointer;background:${color}`
    el.addEventListener('click', () => {
      closeIncomingCall()
      onClick()
    })
    return el
  }
  banner.append(text, button('拒绝', '#d03050', onReject), button('接听', '#034fbc', onAccept))
  document.body.appendChild(banner)
  // 用户还没和页面交互过时浏览器不让自动播放，横幅照常显示，等第一次点击或按键再响
  bell = createCallBell('incoming')
  bell.play()
}
