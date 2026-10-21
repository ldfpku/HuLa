<template>
  <div :class="isMobile() ? 'text-16px' : 'text-14px'">
    <template v-for="(item, index) in fragments" :key="index">
      <n-popover
        trigger="click"
        placement="left"
        :show-arrow="false"
        style="padding: 0; background: var(--bg-info)"
        v-if="mentionTokenSet.has(item) && !props.historyMode">
        <template #trigger>
          <span
            :key="item"
            style="-webkit-user-select: text !important; user-select: text !important"
            class="smj-mention cursor-pointer">
            {{ item }}
          </span>
        </template>
        <InfoPopover v-if="mentionTokenToUid.get(item)" :uid="mentionTokenToUid.get(item)!" />
      </n-popover>
      <span
        v-else-if="mentionTokenSet.has(item)"
        :key="item"
        style="-webkit-user-select: text !important; user-select: text !important"
        class="smj-mention cursor-text">
        {{ item }}
      </span>
      <template v-else-if="item.startsWith('http')">
        <n-flex align="center" :wrap="false">
          <n-tooltip trigger="hover" style="flex-shrink: 0">
            <template #trigger>
              <svg class="size-12px cursor-pointer pr-4px" @click="handleCopy(item)">
                <use href="#copy"></use>
              </svg>
            </template>
            <span>复制网址</span>
          </n-tooltip>
          <div style="flex: 1; word-wrap: break-word; overflow-wrap: anywhere">
            <n-highlight
              v-if="props.searchKeyword"
              :text="item"
              :patterns="[props.searchKeyword]"
              :highlight-style="{
                userSelect: 'text',
                padding: '2px 4px',
                borderRadius: '6px',
                color: 'var(--search-hit-color)',
                background: 'var(--search-hit-bg)',
                fontWeight: 600
              }" />
            <p v-else class="smj-link cursor-pointer" style="margin: 0" @click="openUrl(item)">
              {{ item }}
            </p>
          </div>
        </n-flex>
      </template>
      <n-highlight
        v-else-if="props.searchKeyword"
        :text="item"
        :patterns="[props.searchKeyword]"
        :highlight-style="{
          userSelect: 'text',
          padding: '2px 4px',
          borderRadius: '6px',
          color: 'var(--search-hit-color)',
          background: 'var(--search-hit-bg)',
          fontWeight: 600
        }" />
      <template v-else>{{ item }}</template>
      <div
        v-if="keys.includes(item)"
        :key="item + index"
        rel="noopener noreferrer"
        target="_blank"
        class="text-card"
        :class="{ 'text-card--closed': meetingClosed(item) }"
        @click="openCard(item)">
        <div v-if="urlMap[item].image" class="text-card-image-wrapper">
          <img class="text-card-image" :src="urlMap[item].image" @error="onImageLoadError" />
        </div>
        <div class="text-card-link-content">
          <span class="flex items-center gap-6px min-w-0">
            <span class="text-14px line-clamp-1">{{ urlMap[item].title }}</span>
            <span v-if="meetingBadge(item)" class="meeting-badge" :class="`meeting-badge--${meetingStatus(item)}`">
              {{ meetingBadge(item) }}
            </span>
          </span>
          <span class="text-(12px [--chat-text-color]) mt-4px line-clamp-2">
            {{ meetingDescription(item) ?? urlMap[item].description }}
          </span>
        </div>
        <n-button
          v-if="canCancelMeeting(item)"
          size="tiny"
          secondary
          type="error"
          class="self-center ml-8px flex-shrink-0"
          :loading="cancellingMeeting === item"
          @click.stop="handleCancelMeeting(item)">
          取消会议
        </n-button>
      </div>
    </template>
  </div>
</template>
<script setup lang="ts">
import { openExternalUrl } from '@/hooks/useLinkSegments'
import { parseMeetingLink, useMeeting } from '@/hooks/useMeeting'
import { isMeetingClosed, useMeetingStatusStore, type MeetingStatus } from '@/stores/meetingStatus'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user'
import type { TextBody } from '@/services/types'
import { isMobile } from '@/utils/PlatformConstants'
import { AT_ALL_NAME, AT_ALL_UID } from '@/utils/mention'

// 标记结构用于描述需特殊渲染的片段区间
type ContentMarker = {
  start: number
  end: number
  text: string
  type: 'mention' | 'url'
}

const props = defineProps<{
  body: TextBody
  searchKeyword?: string
  historyMode?: boolean
  fromUserUid?: string
}>()

const userStore = useUserStore()
const { confirmCancelMeeting } = useMeeting()
const meetingStatusStore = useMeetingStatusStore()
const cancellingMeeting = ref<string | null>(null)

/** 会议卡片的状态以服务端为准：卡片出现时查询，之后按时刷新，取消时服务端推送 */
const meetingStatus = (url: string): MeetingStatus | undefined => {
  const id = parseMeetingLink(url)
  return id ? meetingStatusStore.statusOf(id)?.status : undefined
}
const meetingClosed = (url: string) => isMeetingClosed(meetingStatus(url))
const MEETING_BADGE: Record<MeetingStatus, string> = {
  upcoming: '待开始',
  live: '进行中',
  ended: '已结束',
  cancelled: '已取消'
}
const MEETING_DESCRIPTION: Record<MeetingStatus, string> = {
  upcoming: '点击加入会议，可提前进入',
  live: '点击加入会议',
  ended: '会议已结束，无法加入',
  cancelled: '会议已取消，无法加入'
}
const meetingBadge = (url: string) => {
  const status = meetingStatus(url)
  return status ? MEETING_BADGE[status] : null
}
const meetingDescription = (url: string) => {
  const status = meetingStatus(url)
  return status ? MEETING_DESCRIPTION[status] : null
}

/** 发起人在自己发出的会议卡片上可以取消，会议结束或已取消后不再显示 */
const canCancelMeeting = (url: string) => {
  const status = meetingStatus(url)
  return (
    !props.historyMode &&
    !!props.fromUserUid &&
    userStore.isMe(props.fromUserUid) &&
    (status === 'upcoming' || status === 'live')
  )
}
const handleCancelMeeting = (url: string) => {
  const id = parseMeetingLink(url)
  if (!id) return
  confirmCancelMeeting(id, {
    onStart: () => (cancellingMeeting.value = url),
    onDone: (cancelled) => {
      cancellingMeeting.value = null
      if (cancelled) meetingStatusStore.markCancelled(id)
    }
  })
}
// 获取所有匹配的字符串
const urlMap = props.body.urlContentMap || {}
const keys = Object.keys(urlMap)
// 正则表达式常量用于匹配URL
const URL_REGEX = /https?:\/\/[^\s<]+[^<.,:;"')\]\s]/g
const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const groupStore = useGroupStore()

// 仅依赖后端透出的 atUidList，避免用户手动输入的「@文本」被误判
const mentionTokens = computed(() => {
  if (!Array.isArray(props.body.atUidList) || props.body.atUidList.length === 0) {
    return []
  }
  const tokens = new Set<string>()
  props.body.atUidList.forEach((uid) => {
    const user = groupStore.getUserInfo(uid)
    const name = uid === AT_ALL_UID ? AT_ALL_NAME : user?.myName || user?.name
    if (name) {
      tokens.add(`@${name}`)
    }
  })
  return Array.from(tokens)
})
// 使用 Set 快速判断片段是否属于真正的 @ 提及
const mentionTokenSet = computed(() => new Set(mentionTokens.value))

// 创建 mention token 到 uid 的映射
const mentionTokenToUid = computed(() => {
  const map = new Map<string, string>()
  if (!Array.isArray(props.body.atUidList) || props.body.atUidList.length === 0) {
    return map
  }
  props.body.atUidList.forEach((uid) => {
    const user = groupStore.getUserInfo(uid)
    const name = uid === AT_ALL_UID ? AT_ALL_NAME : user?.myName || user?.name
    if (name) {
      map.set(`@${name}`, uid)
    }
  })
  return map
})

// 处理长链接
const processLongUrls = computed(() => {
  let content = props.body.content || ''
  content = content.replace(/&nbsp;/g, '\u00A0')

  return content.replace(URL_REGEX, (match) => {
    // 后端没给预览信息的链接，用会议名或网址的域名作卡片标题
    if (!urlMap[match]) {
      const isMeeting = !!parseMeetingLink(match)
      urlMap[match] = {
        title: isMeeting ? '视频会议' : hostOf(match),
        description: isMeeting ? '点击加入会议' : '链接',
        image: ''
      }
      // 动态添加到keys中
      if (!keys.includes(match)) {
        keys.push(match)
      }
    }
    const meetingId = parseMeetingLink(match)
    if (meetingId) meetingStatusStore.track(meetingId)
    return match
  })
})

// 使用匹配字符串创建动态正则表达式，并将文本拆分为片段数组
const fragments = computed(() => {
  const content = processLongUrls.value

  // 创建一个数组来存储所有的特殊标记位置
  const markers: ContentMarker[] = []

  // 添加@提及的标记，仅基于已匹配的mention列表
  mentionTokens.value.forEach((token) => {
    if (!token) return
    let searchIndex = 0
    while (searchIndex < content.length) {
      const index = content.indexOf(token, searchIndex)
      if (index === -1) break
      markers.push({
        start: index,
        end: index + token.length,
        text: token,
        type: 'mention'
      })
      searchIndex = index + token.length
    }
  })

  // 添加URL的标记
  keys.forEach((key) => {
    let index = 0
    while ((index = content.indexOf(key, index)) !== -1) {
      markers.push({
        start: index,
        end: index + key.length,
        text: key,
        type: 'url'
      })
      index += key.length
    }
  })

  // 按照开始位置排序标记
  markers.sort((a, b) => a.start - b.start)

  // 合并重叠的标记
  for (let i = 0; i < markers.length - 1; i++) {
    if (markers[i + 1].start < markers[i].end) {
      // 如果下一个标记的开始位置在当前标记的结束位置之前，说明有重叠
      // 选择保留较长的标记
      if (markers[i + 1].end - markers[i + 1].start > markers[i].end - markers[i].start) {
        markers.splice(i, 1) // 删除当前标记
      } else {
        markers.splice(i + 1, 1) // 删除下一个标记
      }
      i-- // 重新检查当前位置
    }
  }

  // 构建最终的片段数组
  const result: string[] = []
  let lastEnd = 0

  for (const marker of markers) {
    // 添加标记前的普通文本
    if (marker.start > lastEnd) {
      result.push(content.substring(lastEnd, marker.start))
    }
    // 添加标记的文本
    result.push(marker.text)
    lastEnd = marker.end
  }

  // 添加最后一段普通文本
  if (lastEnd < content.length) {
    result.push(content.substring(lastEnd))
  }

  // 如果没有任何标记，直接返回整个内容
  return result.length > 0 ? result : [content]
})

// 打开链接
const openUrl = (url: string) => openExternalUrl(url)

/** 已结束、已取消的会议卡片点了只提示，不再入会 */
const openCard = (url: string) => {
  if (meetingClosed(url)) {
    window.$message?.info?.(meetingStatus(url) === 'cancelled' ? '会议已取消' : '会议已结束')
    return
  }
  void openUrl(url)
}

// 处理复制
const handleCopy = (item: string) => {
  if (item) {
    navigator.clipboard.writeText(item)
    window.$message.success('复制成功')
  }
}

const onImageLoadError = (e: Event) => {
  const target = e.target as HTMLImageElement
  if (!target) return
  target.style.opacity = '0'
}
</script>

<style scoped>
/** 链接与 @ 提及：BIS B14 链接用斯米伽蓝；自己的气泡是斯米伽蓝底，改白字。信号橙不做文字 */
.smj-link {
  color: #034fbc;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.smj-mention {
  color: #034fbc;
  font-weight: 600;
}
:global([data-theme='dark'] .smj-link),
:global([data-theme='dark'] .smj-mention) {
  color: #7a9fe2;
}
:global(.bubble-oneself .smj-link),
:global(.bubble-oneself .smj-mention),
:global(.bubble-oneself .text-card span) {
  color: #fff;
}
:global(.bubble-oneself .text-card) {
  background-color: rgba(255, 255, 255, 0.12);
}

.text-card {
  display: flex;
  margin: 8px 0;
  padding: 12px;
  border-radius: 4px;
  background-color: rgba(10, 31, 84, 0.04);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.2s ease;
}

.text-card:hover {
  background-color: rgba(10, 31, 84, 0.08);
}

.text-card-image-wrapper {
  width: 60px;
  height: 60px;
  margin-right: 12px;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}

.text-card-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.2s ease;
}

.text-card--closed {
  cursor: default;
}
.text-card--closed .text-card-link-content {
  opacity: 0.7;
}

/** 会议状态标签：进行中用绿色（和共享屏幕的绿色一致），待开始用斯米伽蓝，结束和取消用灰色；橙色只留给选中态 */
.meeting-badge {
  flex-shrink: 0;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 18px;
}
.meeting-badge--upcoming {
  color: #034fbc;
  background-color: rgba(3, 79, 188, 0.1);
}
.meeting-badge--live {
  color: #fff;
  background-color: #12a150;
}
.meeting-badge--ended,
.meeting-badge--cancelled {
  color: #5b6b85;
  background-color: rgba(91, 107, 133, 0.14);
}
:global([data-theme='dark'] .meeting-badge--upcoming) {
  color: #7a9fe2;
  background-color: rgba(122, 159, 226, 0.16);
}
:global([data-theme='dark'] .meeting-badge--ended),
:global([data-theme='dark'] .meeting-badge--cancelled) {
  color: #b4bfd0;
  background-color: rgba(180, 191, 208, 0.16);
}
:global(.bubble-oneself .text-card .meeting-badge--upcoming),
:global(.bubble-oneself .text-card .meeting-badge--ended),
:global(.bubble-oneself .text-card .meeting-badge--cancelled) {
  color: #fff;
  background-color: rgba(255, 255, 255, 0.2);
}

.text-card-link-content {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
  min-width: 0;
}
</style>
