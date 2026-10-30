<template>
  <main class="size-full bg-#fff select-none">
    <ActionBar class="absolute right-0 w-full" :shrink="false" :max-w="false" :min-w="false" />

    <n-flex
      vertical
      :size="130"
      :style="`background: linear-gradient(to bottom, ${RGBA} 0%, #f1f1f1 100%)`"
      class="size-full p-20px box-border"
      data-tauri-drag-region>
      <!-- 当前选中的状态 -->
      <n-flex justify="center" align="center" class="pt-80px" data-tauri-drag-region>
        <span v-if="isConnectionPending" class="block size-34px rounded-50% bg-#f0a020" aria-hidden="true" />
        <img v-else class="w-34px h-34px" :src="statusIcon" alt="" />
        <span class="text-22px ml-8px" :title="statusTitle">{{ displayStatusTitle }}</span>
      </n-flex>

      <!-- 状态 -->
      <n-flex vertical class="w-full h-100vh bg-#f1f1f1 rounded-6px box-border p-13px" data-tauri-drag-region>
        <n-scrollbar style="max-height: 215px">
          <n-flex align="center" :size="10">
            <n-flex
              role="button"
              tabindex="0"
              @click="handleResetState"
              @keydown.enter.prevent="handleResetState"
              @keydown.space.prevent="handleResetState"
              :aria-disabled="changing"
              vertical
              justify="center"
              align="center"
              :size="8"
              class="status-item">
              <svg class="size-24px color-#d03553">
                <use href="#forbid"></use>
              </svg>
              <span class="text-11px" :title="t('auth.onlineStatus.reset_title')">
                {{ t('auth.onlineStatus.reset_title') }}
              </span>
            </n-flex>
            <n-flex
              @click="handleActive(item)"
              @keydown.enter.prevent="handleActive(item)"
              @keydown.space.prevent="handleActive(item)"
              role="button"
              tabindex="0"
              :aria-disabled="changing"
              :class="{ active: hasCustomState && currentState?.id === item.id }"
              v-for="item in stateList"
              :key="item.title"
              vertical
              justify="center"
              align="center"
              :size="8"
              class="status-item">
              <img class="size-24px" :src="userStateIcon(item)" alt="" />
              <span class="text-11px" :title="translateStateTitle(item.title)">
                {{ translateStateTitle(item.title) }}
              </span>
            </n-flex>
          </n-flex>
        </n-scrollbar>
      </n-flex>
    </n-flex>
  </main>
</template>
<script setup lang="ts">
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import type { UserState } from '@/services/types'
import { useUserStore } from '@/stores/user'
import { useUserStatusStore } from '@/stores/userStatus'
import { useOnlineStatus } from '@/hooks/useOnlineStatus.ts'
import { changeUserState, getUserDetail } from '@/utils/ImRequestUtils'
import { changeOwnUserState, userStateChangeError } from '@/utils/UserStateChange'
import { userStateIcon } from '@/utils/UserStateIcon'

const userStatusStore = useUserStatusStore()
const userStore = useUserStore()
const { stateList, stateId } = storeToRefs(userStatusStore)
const { currentState, statusIcon, statusTitle, statusBgColor, hasCustomState, isConnectionPending } = useOnlineStatus()
const { t } = useI18n()
const changing = ref(false)
let stateChangeSequence = 0
const resetState = computed<UserState>(() => ({
  id: '0',
  title: t('auth.onlineStatus.reset_title'),
  url: ''
}))
const translateStateTitle = (title?: string) => {
  if (!title) return ''
  const key = `auth.onlineStatus.states.${title}`
  const translated = t(key)
  return translated === key ? title : translated
}
const displayStatusTitle = computed(() => statusTitle.value)
const handleResetState = () => handleActive(resetState.value)
/** 这里不写入activeItem中是因为v-bind要绑定的值是响应式的 */
const RGBA = ref(statusBgColor.value)

watchEffect(() => {
  RGBA.value = statusBgColor.value
})

/**
 * 处理选中的状态
 * @param { UserState } item 状态
 */
const handleActive = async (item: UserState) => {
  if (changing.value) return
  changing.value = true
  const sequence = ++stateChangeSequence
  try {
    const applied = await changeOwnUserState(item.id, {
      currentAccount: () => userStore.userInfo?.uid,
      change: (id) => changeUserState({ id }),
      readCurrent: () => getUserDetail(false),
      isCurrent: () => stateChangeSequence === sequence,
      apply: (id) => {
        stateId.value = id
        if (userStore.userInfo) userStore.userInfo.userStateId = id
      },
      accountChangedMessage: t('home.profile_edit.toast.account_changed')
    })

    if (!applied) return
    window.$message?.success(t('auth.onlineStatus.messages.success'))
  } catch (error) {
    if (stateChangeSequence !== sequence) return
    console.error('更新状态失败:', error)
    window.$message?.error(userStateChangeError(error, t('auth.onlineStatus.messages.error')))
  } finally {
    changing.value = false
  }
}

onUnmounted(() => {
  stateChangeSequence++
})

onMounted(async () => {
  await getCurrentWebviewWindow().show()
  if (!currentState.value) return
  const matched = stateList.value.find((item: { title: string }) => item.title === currentState.value?.title)
  currentState.value.id = matched?.id || '1'
})
</script>
<style scoped lang="scss">
.status-item {
  width: 56px;
  height: 70px;
  border-radius: 8px;
  transition: all 0.4s ease-in-out;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
  span {
    display: -webkit-box;
    width: 100%;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    white-space: normal;
  }

  &:not(.active):not([aria-disabled='true']):hover {
    background: #ccc;
    cursor: pointer;
  }
}

.status-item[aria-disabled='true'] {
  opacity: 0.5;
  cursor: wait;
}

.active {
  background: v-bind(RGBA);
  border-radius: 8px;
  cursor: pointer;
  span {
    color: #fff;
  }
}

:deep(.action-close) {
  svg {
    color: #404040;
  }
}
/** 隐藏naive UI的滚动条 */
:deep(
  .n-scrollbar > .n-scrollbar-rail.n-scrollbar-rail--vertical > .n-scrollbar-rail__scrollbar,
  .n-scrollbar + .n-scrollbar-rail.n-scrollbar-rail--vertical > .n-scrollbar-rail__scrollbar
) {
  display: none;
}
</style>
