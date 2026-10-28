<template>
  <div v-if="showPopup" class="fixed inset-0 z-50 flex items-start justify-end">
    <!-- 背景遮罩 -->
    <div class="fixed inset-0 bg-black/20" @click="closePopup"></div>

    <!-- 弹窗内容 -->
    <div class="relative w-80 h-screen bg-white shadow-lg flex flex-col">
      <!-- 头部 -->
      <div class="flex items-center justify-between p-16px border-b border-#e5e5e5">
        <h3 class="text-16px font-600">朋友圈通知</h3>
        <div class="flex items-center gap-8px">
          <n-button
            v-if="feednotificationStore.notificationStats.unreadCount > 0"
            text
            type="primary"
            size="small"
            @click="markAllAsRead">
            全部已读
          </n-button>
          <n-button text type="error" size="small" @click="closePopup">关闭</n-button>
        </div>
      </div>

      <!-- 通知列表 -->
      <div class="flex-1 overflow-y-auto">
        <div
          v-if="feednotificationStore.notifications.length === 0"
          class="flex items-center justify-center h-full text-#999">
          暂无通知
        </div>

        <div
          v-for="notification in feednotificationStore.notifications"
          :key="notification.id"
          class="border-b border-#f0f0f0 p-12px hover:bg-#f9f9f9 cursor-pointer transition-colors"
          @click="handleNotificationClick(notification)">
          <!-- 通知项 -->
          <div class="flex gap-12px">
            <!-- 头像 -->
            <n-avatar :size="40" round :src="AvatarUtils.getAvatarUrl(notification.operatorAvatar, notification.operatorUid)" />

            <!-- 内容 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between mb-4px">
                <span class="text-13px font-500 text-#333">{{ notification.operatorName }}</span>
                <span v-if="!notification.isRead" class="w-8px h-8px rounded-full bg-#ff6b6b"></span>
              </div>

              <!-- 通知类型和内容 -->
              <div class="text-12px text-#666 mb-4px">
                <span v-if="notification.type === 'like'" class="text-#ff6b6b">👍 赞了你的朋友圈</span>
                <span v-else class="text-#666">💬 评论了你的朋友圈</span>
              </div>

              <!-- 朋友圈内容预览 -->
              <div class="text-12px text-#999 mb-4px line-clamp-2">{{ notification.feedContent }}</div>

              <!-- 评论内容（仅评论类型） -->
              <div
                v-if="notification.type === 'comment' && notification.commentContent"
                class="text-12px text-#666 bg-#f5f5f5 p-8px rounded mb-4px">
                {{ notification.commentContent }}
              </div>

              <!-- 时间 -->
              <div class="text-11px text-#ccc">{{ formatTime(notification.createTime) }}</div>
            </div>

            <!-- 删除按钮 -->
            <n-button text type="error" size="small" @click.stop="deleteNotification(notification.id)">删除</n-button>
          </div>
        </div>
      </div>

      <!-- 底部操作 -->
      <div v-if="feednotificationStore.notifications.length > 0" class="border-t border-#e5e5e5 p-12px flex gap-8px">
        <n-button type="error" text block size="small" @click="clearAllNotifications">清空所有通知</n-button>
      </div>
    </div>
  </div>

  <!-- 评论详情弹窗 -->
  <n-modal
    v-model:show="showCommentModal"
    preset="dialog"
    title="评论详情"
    positive-text="关闭"
    :show-icon="false"
    @positive-click="showCommentModal = false">
    <div v-if="selectedNotification" class="space-y-16px">
      <!-- 朋友圈内容 -->
      <div class="p-12px bg-#f5f5f5 rounded-8px">
        <div class="text-12px text-#999 mb-4px">朋友圈内容</div>
        <div class="text-13px text-#666">{{ selectedNotification.feedContent }}</div>
      </div>

      <!-- 评论者信息 -->
      <div class="flex items-center gap-12px">
        <n-avatar :size="40" round :src="AvatarUtils.getAvatarUrl(selectedNotification.operatorAvatar, selectedNotification.operatorUid)" />
        <div class="flex-1">
          <div class="text-13px font-500 text-#333">{{ selectedNotification.operatorName }}</div>
          <div class="text-12px text-#999">{{ formatTime(selectedNotification.createTime) }}</div>
        </div>
      </div>

      <!-- 评论内容 -->
      <div
        v-if="selectedNotification.type === 'comment'"
        class="p-12px bg-#f9f9f9 rounded-8px border-l-4 border-#034FBC">
        <div class="text-13px text-#666">{{ selectedNotification.commentContent }}</div>
      </div>

      <!-- 点赞提示 -->
      <div v-else class="p-12px bg-#fff3cd rounded-8px border-l-4 border-#ffc107">
        <div class="text-13px text-#666">👍 赞了你的朋友圈</div>
      </div>
    </div>
  </n-modal>
</template>

<script setup lang="ts">
import { useFeedNotificationStore } from '@/stores/feedNotification'
import { AvatarUtils } from '@/utils/AvatarUtils'

const feednotificationStore = useFeedNotificationStore()
const showPopup = ref(false)
const showCommentModal = ref(false)
const selectedNotification = ref<any>(null)

// 监听通知列表变化
watch(
  () => feednotificationStore.notifications.length,
  (newLength) => {
    console.log('通知列表变化，当前通知数:', newLength)
  }
)

/**
 * 打开弹窗
 */
const openPopup = () => {
  console.log('🔔 打开通知弹窗，当前通知数:', feednotificationStore.notifications.length)
  console.log('🔔 通知列表:', feednotificationStore.notifications)
  showPopup.value = true
}

/**
 * 关闭弹窗
 */
const closePopup = () => {
  showPopup.value = false
}

/**
 * 处理通知点击
 */
const handleNotificationClick = (notification: any) => {
  feednotificationStore.markAsRead(notification.id)
  selectedNotification.value = notification
  showCommentModal.value = true
}

/**
 * 标记所有为已读
 */
const markAllAsRead = () => {
  feednotificationStore.markAllAsRead()
}

/**
 * 删除通知
 */
const deleteNotification = (notificationId: string) => {
  feednotificationStore.deleteNotification(notificationId)
}

/**
 * 清空所有通知
 */
const clearAllNotifications = () => {
  if (confirm('确定要清空所有通知吗？')) {
    feednotificationStore.clearAllNotifications()
  }
}

/**
 * 格式化时间
 */
const formatTime = (timestamp: number) => {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 7) return `${days}天前`

  const date = new Date(timestamp)
  return date.toLocaleDateString()
}

// 暴露方法给父组件
defineExpose({
  openPopup,
  closePopup
})
</script>

<style scoped lang="scss">
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
