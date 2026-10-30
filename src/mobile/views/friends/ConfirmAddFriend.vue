<template>
  <div class="flex flex-col overflow-auto h-full">
    <MobileScaffold :show-footer="false">
      <template #header>
        <HeaderBar
          :isOfficial="false"
          :hidden-right="true"
          :enable-default-background="false"
          :enable-shadow="false"
          :room-name="APP_FEATURES.friendRequests ? '添加好友' : t('message.directory_contact.refresh')" />
      </template>

      <template #container>
        <div class="flex flex-col gap-1 overflow-auto h-full">
          <!-- 内容区域 -->
          <div class="w-full h-full box-border flex flex-col">
            <n-flex vertical justify="center" :size="20" class="p-[55px_20px] m-20px rounded-15px bg-white">
              <n-flex align="center" justify="center" :size="20">
                <n-avatar round size="large" :src="avatarSrc" />

                <n-flex vertical :size="10">
                  <p class="text-[--text-color]">{{ userInfo?.name }}</p>
                  <p class="text-(12px [--text-color])">
                    账号: {{ userInfo?.account || t('message.directory_contact.unknown_account') }}
                  </p>
                </n-flex>
              </n-flex>

              <n-input
                v-if="APP_FEATURES.friendRequests"
                v-model:value="requestMsg"
                :allow-input="(value: string) => !value.startsWith(' ') && !value.endsWith(' ')"
                :autosize="requestMsgAutosize"
                :maxlength="60"
                :count-graphemes="countGraphemes"
                show-count
                spellCheck="false"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                type="textarea"
                placeholder="输入几句话，对TA说些什么吧" />

              <n-button class="mt-30px" color="#034fbc" @click="addFriend">
                {{ APP_FEATURES.friendRequests ? '添加好友' : t('message.directory_contact.refresh') }}
              </n-button>
            </n-flex>
          </div>
        </div>
      </template>
    </MobileScaffold>
  </div>
</template>

<script setup lang="ts">
import { useCommon } from '@/hooks/useCommon.ts'
import { APP_FEATURES } from '@/common/backend'
import { useDirectoryContact } from '@/hooks/useDirectoryContact'
import { useMobileSingleChat } from '@/hooks/useMobileSingleChat'
import { useI18n } from 'vue-i18n'
import { useGlobalStore } from '@/stores/global.ts'
import { useGroupStore } from '@/stores/group'
import { useUserStore } from '@/stores/user.ts'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { sendAddFriendRequest } from '@/utils/ImRequestUtils'
import router from '@/router'

const globalStore = useGlobalStore()
const userStore = useUserStore()
const groupStore = useGroupStore()
const { t } = useI18n()
const { refreshDirectoryContact } = useDirectoryContact()
const { openMobileSingleChat } = useMobileSingleChat()
const { countGraphemes } = useCommon()
const requestMsgAutosize = { minRows: 3, maxRows: 3 }
const userInfo = computed(() => {
  const uid = globalStore.addFriendModalInfo.uid
  return uid ? groupStore.getUserInfo(uid) : undefined
})
const avatarSrc = computed(() => AvatarUtils.getAvatarUrl(userInfo.value?.avatar, userInfo.value?.uid))
const requestMsg = ref()

const addFriend = async () => {
  const uid = globalStore.addFriendModalInfo.uid
  if (!APP_FEATURES.friendRequests) {
    if (uid && (await refreshDirectoryContact(uid))) await openMobileSingleChat(uid)
    else if (!uid) window.$message.error(t('message.directory_contact.refresh_failed'))
    return
  }
  if (!uid) {
    window.$message.error(t('message.directory_contact.refresh_failed'))
    return
  }
  await sendAddFriendRequest({
    msg: requestMsg.value,
    targetUid: uid
  })
  window.$message.success('已发送好友申请')
  setTimeout(() => {
    router.push('/mobile/message')
  }, 2000)
}

onMounted(async () => {
  requestMsg.value = `我是${userStore.userInfo?.name || ''}`
})
</script>

<style scoped lang="scss"></style>
