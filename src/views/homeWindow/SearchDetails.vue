<template>
  <n-flex :size="14" vertical justify="center" class="p-14px text-(12px #909090)">
    <!-- 没有输入时显示历史记录 -->
    <template v-if="!searchQuery">
      <n-flex v-if="historyList.length > 0" align="center" justify="space-between">
        <p class="text-(12px #909090)">{{ t('home.search_history') }}</p>
        <p class="cursor-pointer text-(12px #034fbc)" @click="clearHistory">{{ t('home.clear_search_history') }}</p>
      </n-flex>

      <n-flex
        v-else
        align="center"
        :size="14"
        class="p-6px mb-6px mr-10px cursor-pointer rounded-8px hover:bg-[--list-hover-color]">
        <n-avatar :size="38" round src="msgAction/clapping.png" />
        <p class="text-(12px [--chat-text-color]) flex-1 truncate">{{ t('home.search_guide') }}</p>
      </n-flex>

      <n-scrollbar style="max-height: calc(100vh / var(--page-scale, 1) - 160px)">
        <template v-for="(item, _index) in historyList" :key="_index">
          <n-flex
            align="center"
            :size="14"
            class="p-6px mb-6px mr-10px cursor-pointer rounded-8px hover:bg-[--list-hover-color]"
            @click="openConversation(item)">
            <n-avatar :size="38" round bordered :src="AvatarUtils.getAvatarUrl(item.avatar)" />
            <p class="text-(14px [--text-color]) flex-1 truncate">{{ item.name }}</p>
          </n-flex>
        </template>
      </n-scrollbar>
    </template>

    <!-- 搜索结果：会话、聊天记录、邮件 -->
    <template v-else-if="hasResults">
      <n-scrollbar style="max-height: calc(100vh / var(--page-scale, 1) - 118px)">
        <div class="pr-10px">
          <template v-if="searchResults.length > 0">
            <p class="text-(12px #909090) mb-6px">{{ t('home.search_sessions') }}</p>
            <template v-for="item in searchResults" :key="item.roomId">
              <n-flex
                align="center"
                :size="14"
                class="p-6px mb-6px cursor-pointer rounded-8px hover:bg-[--list-hover-color]"
                @click="openConversation(item)">
                <n-avatar :size="38" round bordered :src="AvatarUtils.getAvatarUrl(item.avatar)" />
                <p class="text-(14px [--text-color]) flex-1 truncate">
                  <template v-for="(part, index) in highlightParts(item.name)" :key="index">
                    <span :class="{ 'text-#034fbc': part.hit }">{{ part.text }}</span>
                  </template>
                </p>
              </n-flex>
            </template>
          </template>

          <template v-if="chatHits.length > 0">
            <p class="text-(12px #909090) mt-8px mb-6px">{{ t('home.search_chat_records') }} · {{ chatTotal }}</p>
            <template v-for="hit in chatHits" :key="hit.msgId">
              <n-flex
                align="center"
                :size="14"
                :wrap="false"
                class="p-6px mb-6px cursor-pointer rounded-8px hover:bg-[--list-hover-color]"
                @click="openChatHit(hit)">
                <n-avatar
                  :size="38"
                  round
                  bordered
                  class="shrink-0"
                  :src="AvatarUtils.getAvatarUrl(hit.roomAvatar || hit.fromAvatar)" />
                <n-flex vertical :size="2" class="flex-1 min-w-0">
                  <n-flex align="center" justify="space-between" :wrap="false" :size="6">
                    <p class="text-(14px [--text-color]) truncate">{{ hit.roomName }}</p>
                    <p class="text-(11px #909090) shrink-0">{{ timeToStr(hit.sendTime) }}</p>
                  </n-flex>
                  <p class="text-(12px [--chat-text-color]) truncate">
                    <span v-if="hit.roomType === RoomTypeEnum.GROUP">{{ hit.fromName }}：</span>
                    <template v-for="(part, index) in highlightParts(hit.text)" :key="index">
                      <span :class="{ 'text-#034fbc': part.hit }">{{ part.text }}</span>
                    </template>
                  </p>
                </n-flex>
              </n-flex>
            </template>
            <p v-if="!chatLast" class="text-(12px #034fbc) cursor-pointer px-6px mb-8px" @click="loadMore('chat')">
              {{ loadingMore === 'chat' ? t('home.search_searching') : t('home.search_load_more') }}
            </p>
          </template>

          <template v-if="mailHits.length > 0">
            <p class="text-(12px #909090) mt-8px mb-6px">{{ t('home.search_mail') }} · {{ mailTotal }}</p>
            <template v-for="mail in mailHits" :key="mail.id">
              <n-flex
                align="center"
                :size="14"
                :wrap="false"
                class="p-6px mb-6px cursor-pointer rounded-8px hover:bg-[--list-hover-color]"
                @click="openMailHit(mail)">
                <div class="size-38px shrink-0 rounded-full bg-#034fbc flex-center">
                  <svg class="size-18px color-#fff"><use href="#mail"></use></svg>
                </div>
                <n-flex vertical :size="2" class="flex-1 min-w-0">
                  <n-flex align="center" justify="space-between" :wrap="false" :size="6">
                    <p
                      class="text-(14px [--text-color]) truncate"
                      :class="{ 'font-bold': !mail.read && !mail.outbound }">
                      <template
                        v-for="(part, index) in highlightParts(mail.subject || t('home.search_no_subject'))"
                        :key="index">
                        <span :class="{ 'text-#034fbc': part.hit }">{{ part.text }}</span>
                      </template>
                    </p>
                    <p class="text-(11px #909090) shrink-0">{{ timeToStr(mail.date) }}</p>
                  </n-flex>
                  <p class="text-(12px #909090) truncate">
                    {{ mail.outbound ? t('home.search_mail_to', { to: mail.to }) : mail.fromName || mail.from }}
                  </p>
                  <p v-if="mail.text" class="text-(12px [--chat-text-color]) truncate">
                    <template v-for="(part, index) in highlightParts(mail.text)" :key="index">
                      <span :class="{ 'text-#034fbc': part.hit }">{{ part.text }}</span>
                    </template>
                  </p>
                </n-flex>
              </n-flex>
            </template>
            <p v-if="!mailLast" class="text-(12px #034fbc) cursor-pointer px-6px mb-8px" @click="loadMore('mail')">
              {{ loadingMore === 'mail' ? t('home.search_searching') : t('home.search_load_more') }}
            </p>
          </template>

          <p v-if="searching" class="text-(12px #909090) px-6px">{{ t('home.search_searching') }}</p>
        </div>
      </n-scrollbar>
    </template>

    <!-- 搜索中 -->
    <template v-else-if="searching">
      <p class="text-(12px #909090)">{{ t('home.search_searching') }}</p>
    </template>

    <!-- 没有搜索结果时 -->
    <template v-else>
      <div style="height: calc(100vh / var(--page-scale, 1) - 212px)" class="flex-col-center gap-12px">
        <img class="size-64px" src="/msgAction/exploding-head.png" />
        <p class="text-(12px [--chat-text-color])">
          {{ searchFailed ? t('home.search_failed') : t('home.no_search_results') }}
        </p>
      </div>
    </template>
  </n-flex>
</template>

<script setup lang="ts">
import { useDebounceFn } from '@vueuse/core'
import { useRouter } from 'vue-router'
import { MittEnum, RoomTypeEnum } from '@/enums'
import { useCommon } from '@/hooks/useCommon.ts'
import { useMessageJump } from '@/hooks/useMessageJump'
import { useMitt } from '@/hooks/useMitt'
import type { ChatSearchHit, MailSearchHit, UnifiedSearchScope } from '@/services/types'
import { useChatStore } from '@/stores/chat.ts'
import { useMailStore } from '@/stores/mail'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { timeToStr } from '@/utils/ComputedTime'
import { unifiedSearch } from '@/utils/ImRequestUtils'
import { useI18n } from 'vue-i18n'

type SessionItem = {
  avatar: string
  name: string
  id?: string
  detailId: string
  roomId: string
  type: number
}
type HistoryItem = {
  avatar: string
  name: string
  id: string
  detailId: string
  roomId: string
  type: number
  timestamp?: number
}

/** 每次向服务端取的条数 */
const PAGE_SIZE = 20

const { t } = useI18n()
const router = useRouter()
const chatStore = useChatStore()
const mailStore = useMailStore()
const { openMsgSession } = useCommon()
const { requestMessageJump } = useMessageJump()
// 从路由参数或共享状态中获取搜索查询
const searchQuery = ref('')
// 会话名称匹配的结果（本地）
const searchResults = ref<SessionItem[]>([])
// 服务端搜到的聊天记录和邮件
const chatHits = ref<ChatSearchHit[]>([])
const chatTotal = ref(0)
const chatLast = ref(true)
const chatPage = ref(1)
const mailHits = ref<MailSearchHit[]>([])
const mailTotal = ref(0)
const mailLast = ref(true)
const mailPage = ref(1)
const searching = ref(false)
const searchFailed = ref(false)
const loadingMore = ref<'chat' | 'mail' | null>(null)
/** 每次输入变化加一，丢弃过期的响应 */
let searchSeq = 0
// 历史记录 - 使用localStorage存储
const HISTORY_STORAGE_KEY = 'HULA_SEARCH_HISTORY'
const historyList = ref<HistoryItem[]>([])

const hasResults = computed(() => searchResults.value.length + chatHits.value.length + mailHits.value.length > 0)

/** 关键词拆成词（去掉排除词和引号），用于高亮 */
const highlightTerms = computed(() =>
  searchQuery.value
    .split(/\s+/)
    .filter((term) => term && !term.startsWith('-') && !term.includes(':'))
    .map((term) => term.replace(/"/g, ''))
    .filter(Boolean)
)

/** 把文本切成普通段和命中段，模板里逐段渲染，不用 v-html */
const highlightParts = (text: string) => {
  const terms = highlightTerms.value
  if (!text || terms.length === 0) return [{ text, hit: false }]
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, hit: terms.some((term) => term.toLowerCase() === part.toLowerCase()) }))
}

// 监听搜索框输入变化
useMitt.on('search_input_change', (value) => {
  searchQuery.value = (value ?? '').trim()
  handleSearch(searchQuery.value)
})

const resetRemote = () => {
  chatHits.value = []
  chatTotal.value = 0
  chatLast.value = true
  chatPage.value = 1
  mailHits.value = []
  mailTotal.value = 0
  mailLast.value = true
  mailPage.value = 1
  searchFailed.value = false
}

// 处理搜索：会话名在本地匹配，聊天记录和邮件交给服务端
const handleSearch = (value: string) => {
  searchSeq += 1
  resetRemote()
  if (!value) {
    searchResults.value = []
    searching.value = false
    return
  }
  const keyword = value.toLowerCase()
  searchResults.value = chatStore.sessionList.filter((session) => session.name.toLowerCase().includes(keyword))
  searching.value = true
  searchRemote(value, searchSeq)
}

const searchRemote = useDebounceFn(async (keyword: string, seq: number) => {
  try {
    const result = await unifiedSearch({ keyword, scope: 'all', page: 1, size: PAGE_SIZE })
    if (seq !== searchSeq) return
    chatHits.value = result?.chat?.list ?? []
    chatTotal.value = result?.chat?.total ?? 0
    chatLast.value = result?.chat?.isLast ?? true
    mailHits.value = result?.mail?.list ?? []
    mailTotal.value = result?.mail?.total ?? 0
    mailLast.value = result?.mail?.isLast ?? true
  } catch (error) {
    if (seq !== searchSeq) return
    console.error('搜索失败:', error)
    searchFailed.value = true
  } finally {
    if (seq === searchSeq) searching.value = false
  }
}, 300)

// 聊天记录和邮件各自翻页
const loadMore = async (scope: Exclude<UnifiedSearchScope, 'all'>) => {
  if (loadingMore.value || !searchQuery.value) return
  const seq = searchSeq
  const page = (scope === 'chat' ? chatPage.value : mailPage.value) + 1
  loadingMore.value = scope
  try {
    const result = await unifiedSearch({ keyword: searchQuery.value, scope, page, size: PAGE_SIZE })
    if (seq !== searchSeq) return
    if (scope === 'chat' && result?.chat) {
      chatHits.value = [...chatHits.value, ...result.chat.list]
      chatTotal.value = result.chat.total
      chatLast.value = result.chat.isLast
      chatPage.value = page
    }
    if (scope === 'mail' && result?.mail) {
      mailHits.value = [...mailHits.value, ...result.mail.list]
      mailTotal.value = result.mail.total
      mailLast.value = result.mail.isLast
      mailPage.value = page
    }
  } catch (error) {
    console.error('加载更多搜索结果失败:', error)
  } finally {
    loadingMore.value = null
  }
}

// 加载历史记录
const loadHistory = () => {
  try {
    const history = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (history) {
      historyList.value = JSON.parse(history)
      // 按时间戳降序排序，最近访问的放在前面
      historyList.value.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      // 只保留前10条记录
      if (historyList.value.length > 10) {
        historyList.value = historyList.value.slice(0, 10)
        // 同步到localStorage
        saveHistoryToStorage()
      }
    }
  } catch (error) {
    console.error('加载历史记录失败:', error)
    // 如果加载失败，重置为空数组
    historyList.value = []
  }
}

// 将历史记录保存到localStorage
const saveHistoryToStorage = () => {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyList.value))
  } catch (error) {
    console.error('保存历史记录失败:', error)
  }
}

// 保存会话到历史记录
const saveSessionToHistory = (session: SessionItem) => {
  // 确保会话有足够的数据
  if (!session || !session.roomId) return

  // 创建一个历史记录项
  const historyItem: HistoryItem = {
    avatar: session.avatar || '',
    name: session.name || '',
    id: session.id || session.detailId,
    detailId: session.detailId,
    roomId: session.roomId,
    type: session.type || RoomTypeEnum.SINGLE,
    timestamp: Date.now() // 添加当前时间戳
  }

  // 检查是否已存在相同的记录
  const existingIndex = historyList.value.findIndex((item) => item.roomId === session.roomId)

  if (existingIndex !== -1) {
    // 如果已存在，删除它（稍后会添加到列表头部）
    historyList.value.splice(existingIndex, 1)
  }

  // 将新的记录添加到列表头部
  historyList.value.unshift(historyItem)

  // 限制历史记录数量为10个
  if (historyList.value.length > 10) {
    historyList.value = historyList.value.slice(0, 10)
  }

  // 保存到localStorage
  saveHistoryToStorage()
}

// 清除历史记录
const clearHistory = () => {
  historyList.value = []
  // 清除localStorage中的记录
  localStorage.removeItem(HISTORY_STORAGE_KEY)
}

// 打开会话
const openConversation = async (item: SessionItem | HistoryItem) => {
  // 保存会话到历史记录
  saveSessionToHistory(item)
  // 返回上一页（关闭搜索页面）
  router.go(-1)
  // 打开对应会话
  const id = item.type === RoomTypeEnum.GROUP ? item.roomId : item.detailId
  await openMsgSession(id, item.type)
  // 定位到对应的会话（让聊天列表滚动到选中的会话）
  nextTick(() => {
    useMitt.emit(MittEnum.LOCATE_SESSION, { roomId: item.roomId })
  })
}

// 打开聊天记录：进入会话后滚动到这条消息
const openChatHit = async (hit: ChatSearchHit) => {
  requestMessageJump({ roomId: hit.roomId, msgId: hit.msgId })
  await openConversation({
    avatar: hit.roomAvatar,
    name: hit.roomName,
    detailId: hit.detailId,
    roomId: hit.roomId,
    type: hit.roomType
  })
}

// 打开邮件：在邮件窗口里显示这封邮件
const openMailHit = async (mail: MailSearchHit) => {
  try {
    await mailStore.openMailMessage(mail)
  } catch (error) {
    console.error('打开邮件失败:', error)
  }
}

onMounted(() => {
  // 加载历史记录
  loadHistory()
})
</script>
