import { computed, type ComputedRef, type Ref, unref } from 'vue'
import { open } from '@tauri-apps/plugin-shell'
import { parseMeetingLink, useMeeting } from '@/hooks/useMeeting'
import { isMeetingClosed, useMeetingStatusStore } from '@/stores/meetingStatus'

export type LinkSegment = {
  text: string
  isLink: boolean
}

type MaybeRef<T> = T | Ref<T> | ComputedRef<T>

const LINK_URL_PATTERN = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/gi

export const extractLinkSegments = (text: string): LinkSegment[] => {
  const content = (text || '').replace(/&nbsp;/g, '\u00a0')
  if (!content) return []

  const segments: LinkSegment[] = []
  const regex = new RegExp(LINK_URL_PATTERN.source, 'gi')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const matchText = match[0]
    const startIndex = match.index

    if (startIndex > lastIndex) {
      segments.push({
        text: content.slice(lastIndex, startIndex),
        isLink: false
      })
    }

    segments.push({
      text: matchText,
      isLink: true
    })

    lastIndex = startIndex + matchText.length
  }

  if (lastIndex < content.length) {
    segments.push({
      text: content.slice(lastIndex),
      isLink: false
    })
  }

  return segments
}

export const normalizeExternalUrl = (url: string) => {
  const trimmed = url?.trim() ?? ''
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export const openExternalUrl = async (url: string) => {
  const normalizedUrl = normalizeExternalUrl(url)
  if (!normalizedUrl) return

  // 会议链接在应用内入会，不跳浏览器
  const meetingId = parseMeetingLink(normalizedUrl)
  if (meetingId) {
    const meetingStatusStore = useMeetingStatusStore()
    const status = meetingStatusStore.statusOf(meetingId)?.status
    if (isMeetingClosed(status)) {
      window.$message?.info?.(status === 'cancelled' ? '会议已取消' : '会议已结束')
      return
    }
    try {
      await useMeeting().openMeeting(meetingId)
      return
    } catch (error) {
      // 服务端说会议已结束或已取消时（已提示过），刷新卡片状态，不再打开浏览器
      if (/会议已(结束|取消)/.test(String(error))) {
        meetingStatusStore.recheck(meetingId)
        return
      }
      console.error('打开会议失败，改用浏览器:', error)
    }
  }

  try {
    await open(normalizedUrl)
  } catch (error) {
    console.error('打开链接失败:', error)
    if (typeof window !== 'undefined') {
      window.open(normalizedUrl, '_blank', 'noreferrer')
    }
  }
}

export const useLinkSegments = (source: MaybeRef<string | null | undefined>) => {
  const segments = computed(() => extractLinkSegments(unref(source) ?? ''))

  return {
    segments,
    openLink: openExternalUrl
  }
}
