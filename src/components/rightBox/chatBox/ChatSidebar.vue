<template>
  <!--! 这里最好不要使用n-flex,滚动高度会有问题  -->
  <main
    style="height: 100%"
    class="flex-shrink-0"
    :class="[
      isGroup
        ? isCollapsed
          ? 'w-0 pr-1px'
          : 'w-180px border-l-(1px solid [--right-chat-footer-line-color]) p-[12px_0_12px_6px] custom-shadow'
        : 'w-0 pr-1px',
      'item-box'
    ]">
    <!-- 收缩按钮 -->
    <div
      role="button"
      :title="isCollapsed ? t('tooltip.expand_sidebar') : t('tooltip.collapse_sidebar')"
      :aria-label="isCollapsed ? t('tooltip.expand_sidebar') : t('tooltip.collapse_sidebar')"
      v-show="isGroup"
      @click.stop="isCollapsed = !isCollapsed"
      style="border-radius: 18px 0 0 18px"
      class="contraction transition-all duration-600 ease-in-out absolute top-35% left--14px cursor-pointer opacity-0 bg-#c8c8c833 h-60px w-14px">
      <svg
        :class="isCollapsed ? 'rotate-0' : 'rotate-180'"
        class="size-16px color-[--icon-color] absolute top-38%">
        <use href="#left-arrow"></use>
      </svg>
    </div>

    <div v-if="isGroup && !isCollapsed">
      <!-- 群名称：群主和管理员可点笔改名 -->
      <n-flex align="center" :size="6" :wrap="false" class="px-4px pt-4px">
        <p class="text-(14px [--text-color]) font-500 truncate flex-1 min-w-0" :title="groupName">{{ groupName }}</p>
        <svg
          v-if="canRename"
          class="size-14px shrink-0 cursor-pointer color-[--icon-color] hover:color-[--link-color]"
          @click="openRenameGroupDialog(globalStore.currentSessionRoomId, groupName)">
          <title>修改群名称</title>
          <use href="#edit"></use>
        </svg>
      </n-flex>

      <!-- 群公告 -->
      <n-flex vertical :size="14" class="px-4px py-10px">
        <n-flex align="center" justify="space-between" :size="8" class="cursor-pointer">
          <p
            class="text-(14px --text-color) truncate flex-1 min-w-0"
            @click="handleOpenAnnoun(announNum === 0 && isAddAnnoun)">
            {{ t('home.chat_sidebar.announcement.title') }}
          </p>
          <svg
            class="size-16px rotate-270 color-[--text-color] shrink-0"
            @click="handleOpenAnnoun(announNum === 0 && isAddAnnoun)">
            <title>
              {{ announNum === 0 && isAddAnnoun ? t('tooltip.add_announcement') : t('tooltip.view_announcement') }}
            </title>
            <use v-if="announNum === 0 && isAddAnnoun" href="#plus"></use>
            <use v-else href="#down"></use>
          </svg>
        </n-flex>

        <!-- 公告加载失败提示 -->
        <n-flex v-if="announError" class="h-74px" align="center" justify="center">
          <div class="text-center">
            <p class="text-(12px [--text-muted-color]) mb-8px">{{ t('home.chat_sidebar.announcement.load_failed') }}</p>
            <n-button size="tiny" @click="announcementStore.loadGroupAnnouncements()">
              {{ t('home.chat_sidebar.actions.retry') }}
            </n-button>
          </div>
        </n-flex>

        <!-- 公告内容 -->
        <n-scrollbar v-else class="h-74px">
          <p class="text-(12px [--text-muted-color]) leading-6 line-clamp-4 max-w-99%" v-if="announNum === 0">
            {{ t('home.chat_sidebar.announcement.default') }}
          </p>
          <p
            v-else
            style="user-select: text"
            class="announcement-text text-(12px [--text-muted-color]) leading-6 line-clamp-4 max-w-99% break-words">
            <template v-if="announcementSegments.length > 0">
              <template v-for="(segment, index) in announcementSegments" :key="index">
                <span
                  v-if="segment.isLink"
                  class="cursor-pointer hover:underline text-[--link-color]"
                  @click.stop="openAnnouncementLink(segment.text)">
                  {{ segment.text }}
                </span>
                <template v-else>{{ segment.text }}</template>
              </template>
            </template>
            <template v-else>{{ announcementContent }}</template>
          </p>
        </n-scrollbar>
      </n-flex>

      <n-flex v-if="!isSearch" align="center" justify="space-between" class="pr-8px pl-8px h-42px">
        <span class="text-14px">{{ t('home.chat_sidebar.online_members', { count: onlineCountDisplay }) }}</span>
        <svg @click="handleSelect" class="size-14px">
          <title>{{ t('tooltip.search_members') }}</title>
          <use href="#search"></use>
        </svg>
      </n-flex>
      <!-- 搜索框 -->
      <n-flex v-else align="center" class="pr-8px h-42px">
        <n-input
          :on-input="handleSearch"
          @blur="handleBlur"
          ref="inputInstRef"
          v-model:value="searchRef"
          clearable
          :placeholder="t('home.chat_sidebar.search.placeholder')"
          type="text"
          size="tiny"
          spellCheck="false"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          class="h-26px w-95% lh-26px rounded-6px">
          <template #prefix>
            <svg class="w-12px h-12px">
              <use href="#search"></use>
            </svg>
          </template>
        </n-input>
      </n-flex>

      <!-- 成员列表 -->
      <n-virtual-list
        id="image-chat-sidebar"
        style="max-height: calc(100vh / var(--page-scale, 1) - 250px)"
        item-resizable
        @scroll="handleScroll($event)"
        :item-size="46"
        :items="displayedUserList">
        <template #default="{ item }">
          <n-popover
            :ref="(el: any) => (infoPopoverRefs[item.uid] = el)"
            @update:show="handlePopoverUpdate(item.uid, $event)"
            trigger="click"
            placement="left"
            :show-arrow="false"
            style="padding: 0; background: var(--bg-info)">
            <template #trigger>
              <ContextMenu
                :content="item"
                @select="$event.click(item, 'Sidebar')"
                :menu="optionsList"
                :special-menu="report">
                <n-flex
                  @click="onClickMember(item)"
                  :key="item.uid"
                  :size="10"
                  align="center"
                  justify="space-between"
                  class="item">
                  <n-flex align="center" :size="8" class="flex-1 truncate">
                    <div class="relative inline-flex items-center justify-center">
                      <n-avatar
                        round
                        class="grayscale"
                        :class="{ 'grayscale-0': item.activeStatus === OnlineEnum.ONLINE }"
                        :size="26"
                        :color="themes.content === ThemeEnum.DARK ? '' : '#fff'"
                        :fallback-src="themes.content === ThemeEnum.DARK ? '/avatar-dark.svg' : '/avatar-light.svg'"
                        :src="AvatarUtils.getAvatarUrl(item.avatar, item.uid)"
                        @load="userLoadedMap[item.uid] = true"
                        @error="userLoadedMap[item.uid] = true" />
                    </div>
                    <n-flex vertical :size="2" class="flex-1 truncate">
                      <p :title="item.name" class="text-12px truncate flex-1 leading-tight">
                        {{ item.myName ? item.myName : item.name }}
                      </p>
                      <n-flex align="center" :size="4" class="flex-1">
                        <img
                          class="size-10px"
                          :src="item.activeStatus === OnlineEnum.ONLINE ? '/status/online.png' : '/status/offline.png'"
                          alt="" />
                        <span class="text-10px text-[--chat-text-color] flex-1 min-w-0 truncate">
                          {{ item.activeStatus === OnlineEnum.ONLINE ? t('home.profile_card.status.online') : t('home.profile_card.status.offline') }}
                          <template v-if="item.activeStatus === OnlineEnum.ONLINE && item.userStateId && item.userStateId !== '1' && getUserState(item.userStateId)">
                            · {{ translateStateTitle(getUserState(item.userStateId)?.title) }}
                          </template>
                        </span>
                      </n-flex>
                    </n-flex>
                  </n-flex>

                  <div
                    v-if="item.roleId === RoleEnum.LORD"
                    class="flex px-4px bg-[--danger-bg] py-3px rounded-4px size-fit select-none">
                    <p class="text-(11px [--danger-text])">{{ t('home.chat_sidebar.roles.owner') }}</p>
                  </div>
                  <div
                    v-if="item.roleId === RoleEnum.ADMIN"
                    class="flex px-4px bg-[--bg-msg-hover] py-3px rounded-4px size-fit select-none">
                    <p class="text-(11px [--link-color])">{{ t('home.chat_sidebar.roles.admin') }}</p>
                  </div>
                </n-flex>
              </ContextMenu>
            </template>
            <!-- 用户个人信息框 -->
            <InfoPopover v-if="selectKey === item.uid" :uid="item.uid" :activeStatus="item.activeStatus" />
          </n-popover>
        </template>
      </n-virtual-list>
    </div>
  </main>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useDebounceFn, useMediaQuery } from '@vueuse/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import type { InputInst } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { MittEnum, OnlineEnum, RoleEnum, ThemeEnum, RoomTypeEnum } from '@/enums'
import { useChatMain } from '@/hooks/useChatMain.ts'
import { useMitt } from '@/hooks/useMitt.ts'
import { usePopover } from '@/hooks/usePopover.ts'
import { useWindow } from '@/hooks/useWindow.ts'
import { useLinkSegments } from '@/hooks/useLinkSegments'
import type { UserItem } from '@/services/types'
import { WsResponseMessageType } from '@/services/wsType.ts'
import { useGlobalStore } from '@/stores/global.ts'
import { useGroupStore } from '@/stores/group.ts'
import { useSettingStore } from '@/stores/setting'
import { useUserStatusStore } from '@/stores/userStatus'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { getUserByIds } from '@/utils/ImRequestUtils'
import { useAnnouncementStore } from '@/stores/announcement'
import { useUserStore } from '@/stores/user'
import { openRenameGroupDialog } from '@/utils/groupDialogs'

const { t } = useI18n()
const appWindow = WebviewWindow.getCurrent()
const emit = defineEmits<(e: 'ready') => void>()
const { createWebviewWindow } = useWindow()
const groupStore = useGroupStore()
const globalStore = useGlobalStore()
const userStore = useUserStore()
const settingStore = useSettingStore()
const announcementStore = useAnnouncementStore()
const { clearAnnouncements } = announcementStore
const { themes } = storeToRefs(settingStore)
const { stateList } = storeToRefs(useUserStatusStore())
const getUserState = (stateId: string) => stateList.value.find((state: { id: string }) => state.id === stateId)
const translateStateTitle = (title?: string) => {
  if (!title) return ''
  const key = `auth.onlineStatus.states.${title}`
  const translated = t(key)
  return translated === key ? title : translated
}
// 当前加载的群聊ID
const onlineCountDisplay = computed(() => {
  return groupStore.countInfo?.onlineNum ?? '–'
})
let presenceTimer: ReturnType<typeof setInterval> | undefined
let refreshingPresence = false
const refreshPresence = async () => {
  const roomId = globalStore.currentSessionRoomId
  if (!isGroup.value || !roomId || refreshingPresence || document.visibilityState === 'hidden') return
  refreshingPresence = true
  try {
    await groupStore.getGroupUserList(roomId, true)
  } catch (error) {
    console.error('刷新群成员在线状态失败:', error)
  } finally {
    refreshingPresence = false
  }
}
const isGroup = computed(() => globalStore.currentSession?.type === RoomTypeEnum.GROUP)
const groupName = computed(() => globalStore.currentSession?.name ?? '')
const canRename = computed(
  () =>
    globalStore.currentSessionRoomId !== '1' &&
    groupStore.userList.some(
      (user) =>
        user.uid === userStore.userInfo?.uid && (user.roleId === RoleEnum.LORD || user.roleId === RoleEnum.ADMIN)
    )
)
// 公告相关计算属性
const { announcementContent, announNum, announError, isAddAnnoun } = storeToRefs(announcementStore)
const { segments: announcementSegments, openLink: openAnnouncementLink } = useLinkSegments(announcementContent)

/** 是否是搜索模式 */
const isSearch = ref(false)
const searchRef = ref('')
const searchRequestId = ref(0)
/** List中的Popover组件实例 */
const infoPopoverRefs = ref<Record<string, any>>([])
const inputInstRef = ref<InputInst | null>(null)
const isCollapsed = ref(false)
const narrowWindow = useMediaQuery('(max-width: 1050px)')
let previousCollapsed = false
watch(
  narrowWindow,
  (narrow) => {
    if (narrow) {
      previousCollapsed = isCollapsed.value
      isCollapsed.value = true
    } else {
      isCollapsed.value = previousCollapsed
    }
  },
  { immediate: true }
)
const { optionsList, report, selectKey } = useChatMain()
const { handlePopoverUpdate, enableScroll } = usePopover(selectKey, 'image-chat-sidebar')
provide('popoverControls', { enableScroll })

// 用于稳定展示的用户列表
const displayedUserList = computed(() => {
  const keyword = searchRef.value.trim().toLowerCase()
  if (!keyword) return groupStore.userList
  return groupStore.userList.filter((member) =>
    member.name?.toLowerCase().includes(keyword) || member.myName?.toLowerCase().includes(keyword)
  )
})
/** 用户信息加载状态 */
const userLoadedMap = ref<Record<string, boolean>>({})

watch(
  () => [globalStore.currentSessionRoomId, isGroup.value] as const,
  async ([roomId, isGroupChat], prevValue) => {
    const [prevRoomId, prevIsGroup] = prevValue ?? [undefined, undefined]
    if (!roomId || !isGroupChat) {
      clearAnnouncements()
      return
    }

    if (roomId === prevRoomId && prevIsGroup === isGroupChat) {
      return
    }

    try {
      await announcementStore.loadGroupAnnouncements(roomId)
    } catch (error) {
      console.error('刷新群公告失败:', error)
    }
  },
  { immediate: true }
)

const onClickMember = async (item: UserItem) => {
  console.log('点击用户', item)
  selectKey.value = item.uid

  // 获取用户的最新数据，并更新 pinia
  getUserByIds([item.uid]).then((users) => {
    if (users && users.length > 0) {
      groupStore.updateUserItem(item.uid, users[0])
    }
  })
}

/**
 * 监听搜索输入过滤用户
 * @param value 输入值
 */
const handleSearch = useDebounceFn((value: string) => {
  searchRef.value = value
}, 10)

const handleBlur = () => {
  if (searchRef.value) return
  isSearch.value = false
  searchRequestId.value++
}

/**
 * 处理滚动事件
 * @param event 滚动事件
 */
const handleScroll = (event: Event) => {
  if (searchRef.value.trim()) {
    return
  }

  const target = event.target as HTMLElement
  const isBottom = target.scrollHeight - target.scrollTop === target.clientHeight

  if (isBottom && !groupStore.userListOptions.loading) {
    groupStore.loadMoreGroupMembers()
  }
}

/**
 * 切换搜索模式并自动聚焦输入框
 */
const handleSelect = () => {
  isSearch.value = !isSearch.value

  if (isSearch.value) {
    nextTick(() => {
      inputInstRef.value?.select()
    })
  } else {
    searchRequestId.value++
    searchRef.value = ''
  }
}

/**
 * 打开群公告
 */
const handleOpenAnnoun = (isAdd: boolean) => {
  nextTick(async () => {
    const roomId = globalStore.currentSessionRoomId
    await createWebviewWindow(
      isAdd ? t('home.chat_sidebar.announcement.window.add') : t('home.chat_sidebar.announcement.window.view'),
      `announList/${roomId}/${isAdd ? 0 : 1}`,
      420,
      620
    )
  })
}

appWindow.listen('announcementUpdated', async (event: any) => {
  if (event.payload) {
    const { hasAnnouncements } = event.payload
    if (hasAnnouncements) {
      // 初始化群公告
      await announcementStore.loadGroupAnnouncements()
      await nextTick()
    }
  }
})

onMounted(async () => {
  presenceTimer = setInterval(() => void refreshPresence(), 30_000)
  document.addEventListener('visibilitychange', refreshPresence)
  // 通知父级：Sidebar 已挂载，可移除占位
  emit('ready')

  useMitt.on(`${MittEnum.INFO_POPOVER}-Sidebar`, (event: any) => {
    selectKey.value = event.uid
    infoPopoverRefs.value[event.uid].setShow(true)
    handlePopoverUpdate(event.uid)
  })

  appWindow.listen('announcementClear', async () => {
    clearAnnouncements()
  })

  // 初始化时获取当前群组用户的信息
  if (groupStore.userList.length > 0) {
    const handleAnnounInitOnEvent = (shouldReload: boolean) => {
      return async (event: any) => {
        if (shouldReload || event) {
          await announcementStore.loadGroupAnnouncements()
        }
      }
    }
    // 监听群公告消息
    useMitt.on(WsResponseMessageType.ROOM_GROUP_NOTICE_MSG, handleAnnounInitOnEvent(true))
    useMitt.on(WsResponseMessageType.ROOM_EDIT_GROUP_NOTICE_MSG, handleAnnounInitOnEvent(true))
  }
})

onUnmounted(() => {
  if (presenceTimer) clearInterval(presenceTimer)
  document.removeEventListener('visibilitychange', refreshPresence)
  groupStore.cleanupSession()
})
</script>

<style scoped lang="scss">
@use '@/styles/scss/chat-sidebar';
</style>
