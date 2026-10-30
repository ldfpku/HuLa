<template>
  <!-- 顶部操作栏和显示用户名 -->
  <main
    v-if="activeItem"
    data-tauri-drag-region
    class="z-999 flex-y-center flex-shrink-0 border-b-(1px solid [--right-chat-footer-line-color]) select-none cursor-default justify-between"
    :class="isPhoneLayout ? 'p-[8px_10px_8px_4px] gap-8px' : 'p-[6px_22px_10px]'">
    <Transition name="loading" mode="out-in">
      <n-flex align="center" :wrap="false" class="min-w-0">
        <!-- 手机单栏：回到会话列表 -->
        <PhoneBackButton v-if="isPhoneLayout" class="-mr-6px" />
        <n-avatar
          :class="[
            'rounded-8px select-none',
            { grayscale: activeItem?.type === RoomTypeEnum.SINGLE && connectionKnown && !isOnline && !isBotUser }
          ]"
          :size="28"
          :color="themes.content === ThemeEnum.DARK ? '' : '#fff'"
          :fallback-src="themes.content === ThemeEnum.DARK ? '/avatar-dark.svg' : '/avatar-light.svg'"
          :src="currentUserAvatar" />
        <label class="flex-y-center gap-6px min-w-0">
          <p
            class="text-(16px [--text-color]) truncate"
            :class="{ 'cursor-pointer hover:color-[--link-color]': canManageGroup }"
            :title="canManageGroup ? '点击修改群名称' : undefined"
            @click="canManageGroup && openRenameGroupDialog(currentSessionRoomId, activeItem?.name || '')">
            {{ groupStore.countInfo?.remark || activeItem?.name }}
          </p>
          <p
            v-if="activeItem?.type === RoomTypeEnum.GROUP && groupStore.countInfo?.memberNum"
            class="text-(11px [--text-muted-color])">
            [{{ groupStore.countInfo?.memberNum }}]
          </p>
          <!-- bot用户标签 -->
          <div
            v-if="isBotUser"
            class="dark:bg-[#034fbc40] bg-[#edf2fb] dark:border-(1px solid #034fbc) border-(1px solid #034fbc) flex-center px-8px py-4px rounded-6px">
            <p class="text-(11px [--link-color])">{{ t('home.chat_header.bot_tag') }}</p>
          </div>
        </label>
        <n-flex v-if="activeItem?.type === RoomTypeEnum.SINGLE && !isBotUser" align="center">
          <template v-if="shouldShowDeleteFriend">
            <n-flex align="center" :size="6">
              <!-- 状态图标 -->
              <n-badge :color="!connectionKnown ? '#f0a020' : isOnline ? '#13987f' : '#909090'" dot />

              <!-- 状态文本 -->
              <p v-if="!isPhoneLayout" class="text-(12px [--text-color])">
                {{ connectionTitle }}
                <template v-if="hasCustomState && customStatusTitle">· {{ customStatusTitle }}</template>
              </p>
            </n-flex>
          </template>

          <template v-else>
            <n-flex align="center" :size="4">
              <svg class="size-16px color-#d03553">
                <use href="#close"></use>
              </svg>
              <p class="text-(12px [--text-color])">{{ directoryStatusText }}</p>
            </n-flex>
          </template>
        </n-flex>
      </n-flex>
    </Transition>
    <!-- 顶部右边选项栏 -->
    <nav
      v-if="shouldShowDeleteFriend || chatStore.isGroup"
      class="options flex-y-center flex-shrink-0 color-[--icon-color]"
      :class="isPhoneLayout ? 'gap-16px' : 'gap-20px'">
      <div v-if="!isChannel && !isBotUser" class="options-box">
        <n-popover trigger="hover" :show-arrow="false" placement="bottom">
          <template #trigger>
            <svg @click="startRtcCall(CallTypeEnum.AUDIO)">
              <use href="#phone-telephone"></use>
            </svg>
          </template>
          <span>{{ t('home.chat_header.toolbar.audio_call') }}</span>
        </n-popover>
      </div>

      <div v-if="!isChannel && !isBotUser" class="options-box">
        <n-popover trigger="hover" :show-arrow="false" placement="bottom">
          <template #trigger>
            <svg @click="startRtcCall(CallTypeEnum.VIDEO)">
              <use href="#video-one"></use>
            </svg>
          </template>
          <span>{{ t('home.chat_header.toolbar.video_call') }}</span>
        </n-popover>
      </div>

      <div v-if="!isChannel && !isBotUser" class="options-box" @click="showScheduleMeeting = true">
        <n-popover trigger="hover" :show-arrow="false" placement="bottom">
          <template #trigger>
            <!-- 预约会议：日历图标 -->
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
              <path d="M3.5 10h17M8 3v4M16 3v4M8 14h3" />
            </svg>
          </template>
          <span>预约会议</span>
        </n-popover>
      </div>

      <div v-if="!isChannel && !isBotUser && !isPhoneLayout" class="options-box">
        <n-popover trigger="hover" :show-arrow="false" placement="bottom">
          <template #trigger>
            <svg @click="handleMedia">
              <use href="#screen-sharing"></use>
            </svg>
          </template>
          <span>{{ t('home.chat_header.toolbar.screen_share') }}</span>
        </n-popover>
      </div>

      <div v-if="!isChannel && !isBotUser && !isPhoneLayout" class="options-box">
        <n-popover trigger="hover" :show-arrow="false" placement="bottom">
          <template #trigger>
            <svg :class="{ 'opacity-40 cursor-not-allowed': chatStore.isGroup }" @click="handleAssist">
              <use href="#remote-control"></use>
            </svg>
          </template>
          <span>
            {{
              chatStore.isGroup
                ? t('home.chat_header.toolbar.remote_assist_group')
                : t('home.chat_header.toolbar.remote_assist_tip')
            }}
          </span>
        </n-popover>
      </div>

      <div
        v-if="!isChannel && !isBotUser && currentSessionRoomId !== '1'"
        class="options-box"
        @click="handleCreateGroupOrInvite">
        <n-popover trigger="hover" :show-arrow="false" placement="bottom">
          <template #trigger>
            <svg>
              <use href="#launch"></use>
            </svg>
          </template>
          <span v-if="activeItem?.type === RoomTypeEnum.GROUP">
            {{ t('home.chat_header.toolbar.invite_to_group') }}
          </span>
          <span v-else>{{ t('home.chat_header.toolbar.start_group_chat') }}</span>
        </n-popover>
      </div>

      <div v-if="!isBotUser" class="options-box" @click="showSummary = true">
        <n-popover trigger="hover" :show-arrow="false" placement="bottom">
          <template #trigger>
            <!-- AI 摘要：文档加星光 -->
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round">
              <path d="M14 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12" />
              <path d="M8 12h6M8 16h8" />
              <path d="M18.5 2.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
            </svg>
          </template>
          <span>AI 摘要</span>
        </n-popover>
      </div>

      <div
        role="button"
        :title="t('tooltip.chat_info')"
        :aria-label="t('tooltip.chat_info')"
        class="options-box"
        @click="sidebarShow = !sidebarShow">
        <svg>
          <use href="#more"></use>
        </svg>
      </div>
    </nav>

    <ChatInnerDrawer v-model:show="sidebarShow" v-if="shouldShowDeleteFriend || chatStore.isGroup">
      <SingleChatSidebar
        v-if="!chatStore.isGroup"
        :active-item="activeItem"
        :is-bot-user="isBotUser"
        @top="handleTop"
        @notification="handleNotification"
        @shield="handleShield"
        @delete="handleDelete" />

      <GroupChatSidebar
        v-else
        :active-item="activeItem"
        :user-list="userList"
        :can-manage="canManageGroup"
        :is-editing-group-name="isEditingGroupName"
        v-model:editing-group-name="editingGroupName"
        v-model:local-my-name="localMyName"
        v-model:local-remark="localRemark"
        :current-session-room-id="currentSessionRoomId"
        v-model:message-setting-type="messageSettingType"
        :message-setting-options="messageSettingOptions"
        @top="handleTop"
        @notification="handleNotification"
        @shield="handleShield"
        @delete="handleDelete"
        @copy="handleCopy"
        @upload-avatar="handleUploadAvatar"
        @group-name-change="handleGroupNameChange"
        @start-edit-group-name="startEditGroupName"
        @group-info-change="handleGroupInfoChange"
        @manage-group-member="handleManageGroupMember"
        @show-qr-code="showQRCodeModal = true" />
    </ChatInnerDrawer>
  </main>

  <!-- 弹出框 -->
  <n-modal v-model:show="modalShow" class="w-350px rounded-8px">
    <div class="bg-[--bg-popover] w-360px h-full p-6px box-border flex flex-col">
      <div
        role="button"
        :title="t('tooltip.close')"
        :aria-label="t('tooltip.close')"
        v-if="isMac()"
        @click="modalShow = false"
        class="mac-close z-999 size-13px shadow-inner bg-#ed6a5eff rounded-50% select-none absolute left-6px">
        <svg class="hidden size-7px color-#000 select-none absolute top-3px left-3px">
          <use href="#close"></use>
        </svg>
      </div>

      <svg v-if="isWindows()" @click="modalShow = false" class="size-12px ml-a cursor-pointer select-none">
        <title>{{ t('tooltip.close') }}</title>
        <use href="#close"></use>
      </svg>
      <div class="flex flex-col gap-30px p-[22px_10px_10px_22px] select-none">
        <span class="text-14px">{{ tips }}</span>

        <n-flex justify="end">
          <n-button @click="handleConfirm" class="w-78px" color="#034fbc" text-color="#ffffff">
            {{ t('home.chat_header.modal.confirm') }}
          </n-button>
          <n-button @click="handleCancel" class="w-78px" secondary>{{ t('home.chat_header.modal.cancel') }}</n-button>
        </n-flex>
      </div>
    </div>
  </n-modal>

  <!-- 预约视频会议（邮件邀请 + 日历邀请） -->
  <ChatSummaryModal
    v-if="currentSessionRoomId"
    v-model:show="showSummary"
    :room-id="currentSessionRoomId"
    :room-name="activeItem?.name" />

  <ScheduleMeetingModal
    v-if="currentSessionRoomId"
    v-model:show="showScheduleMeeting"
    :room-id="currentSessionRoomId"
    :default-title="activeItem?.name ? `${activeItem.name} 的会议` : undefined" />

  <!-- 群二维码分享弹窗 -->
  <GroupQrCodeModal
    v-model:show="showQRCodeModal"
    :avatar="activeItem?.avatar || ''"
    :name="groupStore.countInfo?.remark || activeItem?.name || ''"
    :account="activeItem?.account || ''"
    :room-id="currentSessionRoomId"
    :on-copy-account="handleCopy" />

  <!-- 管理群成员弹窗 -->
  <n-modal v-model:show="showManageGroupMemberModal" class="w-600px rounded-8px" :mask-closable="false">
    <div class="bg-[--bg-popover] w-600px p-6px box-border flex flex-col">
      <div
        role="button"
        :title="t('tooltip.close')"
        :aria-label="t('tooltip.close')"
        v-if="isMac()"
        @click="showManageGroupMemberModal = false"
        class="mac-close z-999 size-13px shadow-inner bg-#ed6a5eff rounded-50% select-none absolute left-6px">
        <svg class="hidden size-7px color-#000 select-none absolute top-3px left-3px">
          <use href="#close"></use>
        </svg>
      </div>

      <svg
        v-if="isWindows()"
        @click="showManageGroupMemberModal = false"
        class="size-12px ml-a cursor-pointer select-none">
        <title>{{ t('tooltip.close') }}</title>
        <use href="#close"></use>
      </svg>

      <div class="flex flex-col h-600px">
        <ManageGroupMember @close="showManageGroupMemberModal = false" />
      </div>
    </div>
  </n-modal>

  <!-- 添加裁剪组件和文件输入框 -->
  <input
    ref="fileInput"
    type="file"
    accept="image/jpeg,image/png,image/webp"
    class="hidden"
    @change="handleFileChange" />
  <AvatarCropper ref="cropperRef" v-model:show="showCropper" :image-url="localImageUrl" @crop="handleCrop" />
</template>

<script setup lang="ts">
import { APP_FEATURES } from '@/common/backend'
import { useI18n } from 'vue-i18n'
import { ErrorType } from '@/common/exception'
import { useDisplayMedia } from '@vueuse/core'
import AvatarCropper from '@/components/common/AvatarCropper.vue'
import PhoneBackButton from '@/components/common/PhoneBackButton.vue'
import ManageGroupMember from '@/views/ManageGroupMember.vue'
import {
  CallTypeEnum,
  MittEnum,
  NotificationTypeEnum,
  RoleEnum,
  RoomActEnum,
  RoomTypeEnum,
  ThemeEnum,
  TauriCommand,
  UserType
} from '@/enums'
import { useAvatarUpload } from '@/hooks/useAvatarUpload'
import { useGroupExit } from '@/hooks/useGroupExit'
import { useMyRoomInfoUpdater } from '@/hooks/useMyRoomInfoUpdater'
import { useMitt } from '@/hooks/useMitt.ts'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { isPhoneLayout } from '@/hooks/usePhoneLayout'
import { useWindow } from '@/hooks/useWindow'
import { IsAllUserEnum, type UserItem } from '@/services/types.ts'
import { WsResponseMessageType } from '@/services/wsType'
import { useChatStore } from '@/stores/chat.ts'
import { useContactStore } from '@/stores/contacts.ts'
import { useGlobalStore } from '@/stores/global'
import { useGroupStore } from '@/stores/group.ts'
import { useSettingStore } from '@/stores/setting'
import { useUserStore } from '@/stores/user.ts'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { notification, setSessionTop, shield, updateRoomInfo } from '@/utils/ImRequestUtils'
import { invokeWithErrorHandler } from '@/utils/TauriInvokeHandler'
import { isMac, isWindows } from '@/utils/PlatformConstants'
import ChatInnerDrawer from '../../chat-inner-drawer.vue'
import SingleChatSidebar from './SingleChatSidebar.vue'
import GroupChatSidebar from './GroupChatSidebar.vue'
import { GROUP_NAME_MAX_LENGTH, openRenameGroupDialog } from '@/utils/groupDialogs'
import GroupQrCodeModal from './GroupQrCodeModal.vue'
import ScheduleMeetingModal from '@/components/meeting/ScheduleMeetingModal.vue'
import ChatSummaryModal from '@/components/ai/ChatSummaryModal.vue'

const { t } = useI18n()
const { confirmExitGroup } = useGroupExit()
const { createModalWindow, startRtcCall } = useWindow()
// 使用useDisplayMedia获取屏幕共享的媒体流
const { stream, stop } = useDisplayMedia()
const chatStore = useChatStore()
const groupStore = useGroupStore()
const globalStore = useGlobalStore()
const contactStore = useContactStore()
const userStore = useUserStore()
const settingStore = useSettingStore()
const { themes } = storeToRefs(settingStore)
/** 提醒框标题 */
const tips = ref()
const optionsType = ref<RoomActEnum>()
const modalShow = ref(false)
const sidebarShow = ref(false)
const showQRCodeModal = ref(false)
const showScheduleMeeting = ref(false)
const showSummary = ref(false)
const showManageGroupMemberModal = ref(false)
const { currentSession: activeItem, currentSessionRoomId } = storeToRefs(globalStore)
const { persistMyRoomInfo, resolveMyRoomNickname } = useMyRoomInfoUpdater()

// 是否为频道（仅显示 more 按钮）
const isChannel = computed(() => activeItem.value?.hotFlag === IsAllUserEnum.Yes || currentSessionRoomId.value === '1')
// 是否为bot用户
const isBotUser = computed(() => activeItem.value?.account === UserType.BOT)
// 是否可管理群资料（群主或管理员可改群名、群头像）
const canManageGroup = computed(() => {
  const session = activeItem.value
  if (!session || currentSessionRoomId.value === '1' || session.hotFlag === IsAllUserEnum.Yes) {
    return false
  }

  // 检查groupStore.userList中当前用户的角色
  const currentUser = groupStore.userList.find((user) => user.uid === userStore.userInfo!.uid)
  return currentUser?.roleId === RoleEnum.LORD || currentUser?.roleId === RoleEnum.ADMIN
})

// 是否正在编辑群名称
const isEditingGroupName = ref(false)
// 编辑中的群名称
const editingGroupName = ref('')
// 待保存的群信息
const pendingGroupInfo = ref<{
  groupName?: string
  myName?: string
  remark?: string
} | null>(null)
// 本地暂存的群昵称和群备注（避免实时修改store）
const localMyName = ref('')
const localRemark = ref('')

// 初始化本地变量
const initLocalValues = () => {
  localMyName.value = resolveMyRoomNickname({
    roomId: currentSessionRoomId.value,
    myName: groupStore.myNameInCurrentGroup || ''
  })
  localRemark.value = groupStore.countInfo?.remark || ''
}

watch(
  () => groupStore.myNameInCurrentGroup,
  (newName) => {
    const normalized = resolveMyRoomNickname({
      roomId: currentSessionRoomId.value,
      myName: newName || ''
    })
    if (localMyName.value !== normalized) {
      localMyName.value = normalized
    }
  }
)
// 监听当前会话变化，重新初始化本地变量
watch(
  () => currentSessionRoomId.value,
  () => {
    if (currentSessionRoomId.value) {
      nextTick(() => {
        initLocalValues()
      })
    }
  }
)

const messageSettingType = computed({
  get() {
    if (activeItem.value?.muteNotification === NotificationTypeEnum.NOT_DISTURB) {
      return activeItem.value?.shield ? 'shield' : 'notification'
    }
    return 'notification'
  },
  set(value: string) {
    const session = activeItem.value
    if (!session) return
    if (value === 'shield' && !session.shield) {
      handleShield(true)
    } else if (value === 'notification' && session.shield) {
      handleShield(false)
    }
  }
})
const messageSettingOptions = computed(() => [
  { label: t('home.chat_header.message_setting.receive_no_alert'), value: 'notification' },
  { label: t('home.chat_header.message_setting.shield'), value: 'shield' }
])

const chatTargetUid = computed(() => {
  const session = activeItem.value
  if (!session || session.type === RoomTypeEnum.GROUP) return undefined
  return session.detailId
})
const { isOnline, connectionKnown, connectionTitle, customStatusTitle, hasCustomState } = useOnlineStatus(chatTargetUid)

/** 是否还是好友 */
const shouldShowDeleteFriend = computed(() => {
  const session = activeItem.value
  if (!session || session.type === RoomTypeEnum.GROUP) return false
  return contactStore.contactsList.some((item) => item.uid === session.detailId)
})
const directoryStatusText = computed(() => {
  if (APP_FEATURES.friendRequests) return t('home.chat_header.status_abnormal')
  if (contactStore.contactsOptions.isLoading || (!contactStore.contactsLoaded && !contactStore.contactsLoadError)) {
    return t('message.directory_contact.checking')
  }
  return t(
    contactStore.contactsLoadError
      ? 'message.directory_contact.refresh_failed'
      : 'message.directory_contact.not_in_directory'
  )
})
const groupUserList = computed(() => groupStore.userList)
const userList = computed(() => {
  return groupUserList.value
    .map((item: UserItem) => {
      const { uid, ...userInfo } = item // 排除uid，获取剩余内容
      return {
        ...userInfo,
        ...groupStore.getUserInfo(item.uid)!,
        uid
      }
    })
    .sort((a, b) => {
      // 将uid转换为数字进行比较
      return Number(a.uid) - Number(b.uid)
    })
    .slice(0, 10)
})

// 获取用户的最新头像
const currentUserAvatar = computed(() => {
  const session = activeItem.value
  if (!session) return ''
  if (session.type === RoomTypeEnum.GROUP) {
    return AvatarUtils.getAvatarUrl(session.avatar)
  }
  if (session.detailId) {
    const detailUser = groupStore.getUserInfo(session.detailId)
    return AvatarUtils.getAvatarUrl(detailUser?.avatar || session.avatar, session.detailId)
  }
  return AvatarUtils.getAvatarUrl(session.avatar)
})
// 使用自定义hook处理头像上传
const {
  localImageUrl,
  showCropper,
  openFileSelector,
  handleFileChange,
  handleCrop: onCrop
} = useAvatarUpload({
  onSuccess: async (downloadUrl) => {
    const session = activeItem.value
    if (!session) return
    await updateRoomInfo({
      id: currentSessionRoomId.value,
      avatar: downloadUrl
    })
  }
})

watchEffect(() => {
  stream.value?.getVideoTracks()[0]?.addEventListener('ended', () => {
    stop()
  })
})

// 处理复制账号
const handleCopy = () => {
  const session = activeItem.value
  if (!session?.account) return
  navigator.clipboard.writeText(session.account)
  window.$message.success(t('home.chat_header.toast.copy_success', { account: session.account }))
}

/** 处理创建群聊或邀请进群 */
const handleCreateGroupOrInvite = () => {
  const session = activeItem.value
  if (!session) return
  if (session.type === RoomTypeEnum.GROUP) {
    handleInvite()
  } else {
    handleCreateGroup()
  }
}

/** 处理创建群聊 */
const handleCreateGroup = () => {
  const session = activeItem.value
  if (!session) return
  useMitt.emit(MittEnum.CREATE_GROUP, { id: session.detailId })
}

/** 处理邀请进群 */
const handleInvite = async () => {
  const session = activeItem.value
  if (!session) return
  // 使用封装后的createModalWindow方法创建模态窗口，并传递当前会话的 roomId
  await createModalWindow(t('home.chat_header.modal.invite_friends'), 'modal-invite', 600, 500, 'home', {
    roomId: currentSessionRoomId.value,
    type: session.type
  })
}

/** 处理管理群成员 */
const handleManageGroupMember = () => {
  // 打开管理群成员弹窗
  showManageGroupMemberModal.value = true
}

// 保存群聊信息
const saveGroupInfo = async () => {
  const session = activeItem.value
  if (!currentSessionRoomId.value || session?.type !== RoomTypeEnum.GROUP) return

  const pendingInfo = pendingGroupInfo.value
  if (!pendingInfo) return

  const myName = pendingInfo.myName ?? ''
  const remark = pendingInfo.remark ?? ''

  try {
    await persistMyRoomInfo({
      roomId: currentSessionRoomId.value,
      myName,
      remark
    })

    localMyName.value = resolveMyRoomNickname({
      roomId: currentSessionRoomId.value,
      myName
    })
    localRemark.value = remark

    window.$message.success(t('home.chat_header.toast.group_info_updated'))
    pendingGroupInfo.value = null
  } catch (error) {
    console.error('更新群聊信息失败:', error)
    window.$message.error(t('home.chat_header.toast.group_info_update_failed'))
  }
}

// 私聊：发起语音通话，接通后自动请求控制对方电脑（对方桌面版确认）；群聊不支持
const handleAssist = () => {
  if (chatStore.isGroup) {
    window.$message.info(t('home.chat_header.toolbar.remote_assist_group'))
    return
  }
  void startRtcCall(CallTypeEnum.AUDIO, { remoteControl: true })
}

// 私聊：发起语音通话，接通后提示开始共享；群聊：发起会议，在会议里共享
const handleMedia = () => {
  void startRtcCall(CallTypeEnum.AUDIO, { shareScreen: true })
}

/** 置顶 */
const handleTop = (value: boolean) => {
  const session = activeItem.value
  if (!session) return
  setSessionTop({ roomId: currentSessionRoomId.value, top: value })
    .then(() => {
      // 更新本地会话状态
      chatStore.updateSession(currentSessionRoomId.value, { top: value })
      window.$message.success(value ? t('home.chat_header.toast.pin_on') : t('home.chat_header.toast.pin_off'))
    })
    .catch(() => {
      window.$message.error(t('home.chat_header.toast.pin_failed'))
    })
}

/** 处理消息免打扰 */
const handleNotification = (value: boolean) => {
  const session = activeItem.value
  if (!session) return
  const newType = value ? NotificationTypeEnum.NOT_DISTURB : NotificationTypeEnum.RECEPTION
  // 如果当前是屏蔽状态，需要先取消屏蔽
  if (session.shield) {
    handleShield(false)
  }
  notification({
    roomId: currentSessionRoomId.value,
    type: newType
  })
    .then(() => {
      // 更新本地会话状态
      chatStore.updateSession(currentSessionRoomId.value, {
        muteNotification: newType
      })

      // 如果从免打扰切换到允许提醒，需要重新计算全局未读数
      if (session.muteNotification === NotificationTypeEnum.NOT_DISTURB && newType === NotificationTypeEnum.RECEPTION) {
        chatStore.updateTotalUnreadCount()
      }

      // 如果设置为免打扰，也需要更新全局未读数，因为该会话的未读数将不再计入
      if (newType === NotificationTypeEnum.NOT_DISTURB) {
        chatStore.updateTotalUnreadCount()
      }

      window.$message.success(value ? t('home.chat_header.toast.mute_on') : t('home.chat_header.toast.mute_off'))
    })
    .catch(() => {
      window.$message.error(t('home.chat_header.toast.action_failed'))
    })
}

/** 处理屏蔽消息 */
const handleShield = (value: boolean) => {
  const session = activeItem.value
  if (!session) return
  shield({
    roomId: currentSessionRoomId.value,
    state: value
  })
    .then(() => {
      // 更新本地会话状态
      chatStore.updateSession(currentSessionRoomId.value, {
        shield: value
      })

      // 1. 先保存当前聊天室ID
      const tempRoomId = globalStore.currentSessionRoomId

      // 3. 在下一个tick中恢复原来的聊天室ID，触发重新加载消息
      nextTick(() => {
        globalStore.updateCurrentSessionRoomId(tempRoomId)
      })

      window.$message.success(value ? t('home.chat_header.toast.shield_on') : t('home.chat_header.toast.shield_off'))
    })
    .catch(() => {
      window.$message.error(t('home.chat_header.toast.action_failed'))
    })
}

/** 处理群名称修改失焦 */
const handleGroupNameChange = () => {
  const session = activeItem.value
  if (!session) return
  const trimmedName = editingGroupName.value.trim()

  // 检查名称是否有变化
  if (trimmedName !== session.name) {
    // 检查名称是否为空或超过12个字符
    if (trimmedName === '') {
      window.$message.warning(t('home.chat_header.toast.group_name_empty'))
      return
    }
    if (trimmedName.length > GROUP_NAME_MAX_LENGTH) {
      window.$message.warning(t('home.chat_header.toast.group_name_too_long'))
      return
    }

    // 保存待修改的群名称并触发确认弹窗
    pendingGroupInfo.value = { groupName: trimmedName }
    handleDelete(RoomActEnum.UPDATE_GROUP_NAME)
  } else {
    // 名称没有变化，直接退出编辑模式
    isEditingGroupName.value = false
  }
}

/** 处理群信息修改失焦 */
const handleGroupInfoChange = () => {
  // 检查是否有修改
  const originalMyName = groupStore.myNameInCurrentGroup || ''
  const originalRemark = groupStore.countInfo?.remark || ''

  if (localMyName.value !== originalMyName || localRemark.value !== originalRemark) {
    // 保存待修改的群信息并触发确认弹窗
    pendingGroupInfo.value = {
      myName: localMyName.value,
      remark: localRemark.value
    }
    handleDelete(RoomActEnum.UPDATE_GROUP_INFO)
  }
}

const deleteRoomMessages = async (roomId: string) => {
  if (!roomId) return
  try {
    await invokeWithErrorHandler(
      TauriCommand.DELETE_ROOM_MESSAGES,
      { roomId },
      {
        customErrorMessage: t('home.chat_header.toast.delete_history_failed'),
        errorType: ErrorType.Client
      }
    )
    chatStore.clearRoomMessages(roomId)
    useMitt.emit(MittEnum.UPDATE_SESSION_LAST_MSG, { roomId })
    window.$message?.success(t('home.chat_header.toast.delete_history_success'))
    modalShow.value = false
    sidebarShow.value = false
  } catch (error) {
    console.error('删除聊天记录失败:', error)
  }
}

/** 删除操作二次提醒 */
const handleDelete = (label: RoomActEnum) => {
  if (label === RoomActEnum.DISSOLUTION_GROUP || label === RoomActEnum.EXIT_GROUP) {
    confirmExitGroup(
      currentSessionRoomId.value,
      activeItem.value?.name ?? '',
      label === RoomActEnum.DISSOLUTION_GROUP,
      () => {
        sidebarShow.value = false
      }
    )
    return
  }
  modalShow.value = true
  optionsType.value = label
  if (label === RoomActEnum.DELETE_FRIEND) {
    tips.value = t('home.chat_header.modal.tips.delete_friend')
  } else if (label === RoomActEnum.UPDATE_GROUP_NAME) {
    tips.value = t('home.chat_header.modal.tips.rename_group', {
      name: pendingGroupInfo.value?.groupName ?? ''
    })
  } else if (label === RoomActEnum.UPDATE_GROUP_INFO) {
    tips.value = t('home.chat_header.modal.tips.update_info')
  } else {
    tips.value = t('home.chat_header.modal.tips.delete_history')
    optionsType.value = RoomActEnum.DELETE_RECORD
  }
}

const handleConfirm = async () => {
  const currentOption = optionsType.value
  const targetRoomId = currentSessionRoomId.value
  const targetDetailId = activeItem.value?.detailId

  if (currentOption === undefined || currentOption === null || !targetRoomId) return

  if (currentOption === RoomActEnum.DELETE_FRIEND && targetDetailId) {
    try {
      await contactStore.onDeleteFriend(targetDetailId)
      useMitt.emit(MittEnum.DELETE_SESSION, targetRoomId)
      window.$message.success(t('home.chat_header.toast.delete_friend_success'))
      modalShow.value = false
      sidebarShow.value = false
    } catch (error) {
      console.error('删除好友失败:', error)
    }
  } else if (currentOption === RoomActEnum.DELETE_RECORD) {
    await deleteRoomMessages(targetRoomId)
  } else if (currentOption === RoomActEnum.UPDATE_GROUP_NAME) {
    // 确认修改群名称
    await saveGroupName()
    modalShow.value = false
  } else if (currentOption === RoomActEnum.UPDATE_GROUP_INFO) {
    // 确认修改群信息
    await saveGroupInfo()
    modalShow.value = false
  }
}

const handleCancel = () => {
  const session = activeItem.value
  // 如果是取消群信息修改，需要恢复原始值
  if (optionsType.value === RoomActEnum.UPDATE_GROUP_NAME) {
    // 取消群名称修改，退出编辑模式
    isEditingGroupName.value = false
    editingGroupName.value = session?.name || ''
  } else if (optionsType.value === RoomActEnum.UPDATE_GROUP_INFO) {
    // 取消群信息修改，恢复本地变量到原始值
    localMyName.value = groupStore.myNameInCurrentGroup || ''
    localRemark.value = groupStore.countInfo?.remark || ''
  }

  // 清空待保存的群信息
  pendingGroupInfo.value = null
  modalShow.value = false
}

// 开始编辑群名称
const startEditGroupName = () => {
  if (!canManageGroup.value) return

  editingGroupName.value = activeItem.value?.name || ''
  isEditingGroupName.value = true
}

// 保存群名称
const saveGroupName = async () => {
  if (!canManageGroup.value || !currentSessionRoomId.value) return

  isEditingGroupName.value = false

  // 使用 pendingGroupInfo 中的群名称
  const trimmedName = pendingGroupInfo.value?.groupName
  if (!trimmedName) return

  try {
    // 调用更新群信息的API
    await updateRoomInfo({
      id: currentSessionRoomId.value,
      name: trimmedName
    })
    // 清空待保存的群信息
    pendingGroupInfo.value = null
  } catch (error) {
    window.$message.error(t('home.chat_header.toast.group_name_update_failed'))
    console.error('更新群名称失败:', error)
  }
}

// 处理上传头像
const handleUploadAvatar = () => {
  if (!canManageGroup.value || !currentSessionRoomId.value) return

  openFileSelector()
}

// 处理裁剪，调用hook中的方法
const handleCrop = async (cropBlob: Blob) => {
  await onCrop(cropBlob)
}

const closeMenu = (event: any) => {
  /** 点击非侧边栏元素时，关闭侧边栏，但点击弹出框元素、侧边栏图标、还有侧边栏里面的元素时不关闭 */
  if (!event.target.matches('.sidebar, .sidebar *, .n-modal-mask, .options-box *, .n-modal *') && !modalShow.value) {
    sidebarShow.value = false
  }
}

onMounted(() => {
  window.addEventListener('click', closeMenu, true)
  // 初始化本地变量
  initLocalValues()
})

onUnmounted(() => {
  window.removeEventListener('click', closeMenu, true)
  useMitt.off(WsResponseMessageType.VideoCallRequest, () => {})
})
</script>

<style scoped lang="scss">
@use '@/styles/scss/chat-header';

.loading-enter-active,
.loading-leave-active {
  transition: opacity 0.3s ease;
}

.loading-enter-from,
.loading-leave-to {
  opacity: 0;
}

:deep(.n-scrollbar > .n-scrollbar-container > .n-scrollbar-content) {
  padding-left: 2px;
}
</style>
