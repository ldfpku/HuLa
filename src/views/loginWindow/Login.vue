<template>
  <!-- 单独使用n-config-provider来包裹不需要主题切换的界面 -->
  <n-config-provider :theme="naiveTheme" data-tauri-drag-region class="login-box size-full rounded-8px select-none">
    <header class="login-header" data-tauri-drag-region>
      <ActionBar :max-w="false" :shrink="false" proxy />
      <div class="login-brand" data-tauri-drag-region>
        <BrandLogo class="login-logo" on-dark />
      </div>
    </header>

    <!--  手动登录样式  -->
    <n-flex vertical :size="14" v-if="uiState === 'manual'" class="login-manual">
      <!-- 头像 -->
      <n-flex justify="center" class="w-full" data-tauri-drag-region>
        <n-avatar
          class="login-avatar size-56px rounded-50%"
          :color="themes.content === ThemeEnum.DARK ? '#282828' : '#fff'"
          :fallback-src="themes.content === ThemeEnum.DARK ? '/avatar-dark.svg' : '/avatar-light.svg'"
          :src="AvatarUtils.getAvatarUrl(info.avatar, info.uid)" />
      </n-flex>

      <!-- 登录菜单 -->
      <n-flex class="login-form" vertical :size="12">
        <n-input
          size="large"
          v-model:value="info.account"
          type="text"
          :placeholder="accountPH"
          @focus="accountPH = ''"
          @blur="accountPH = t('login.input.account.placeholder')"
          spellCheck="false"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          clearable>
          <template #suffix>
            <span v-if="accountSuffix" class="login-domain-suffix text-13px color-[--text-muted-color] select-none">
              {{ accountSuffix }}
            </span>
            <n-flex
              role="button"
              :title="arrowStatus ? t('tooltip.hide_accounts') : t('tooltip.show_accounts')"
              :aria-label="arrowStatus ? t('tooltip.hide_accounts') : t('tooltip.show_accounts')"
              v-if="loginHistories.length > 0"
              @click="arrowStatus = !arrowStatus">
              <svg v-if="!arrowStatus" class="down w-18px h-18px color-#505050 dark:color-#909090 cursor-pointer">
                <use href="#down"></use>
              </svg>
              <svg v-else class="down w-18px h-18px color-#505050 dark:color-#909090 cursor-pointer">
                <use href="#up"></use>
              </svg>
            </n-flex>
          </template>
        </n-input>

        <!-- 账号选择框-->
        <div
          style="border: 1px solid rgba(70, 70, 70, 0.1)"
          v-if="loginHistories.length > 0 && arrowStatus"
          class="account-box absolute w-260px max-h-140px bg-#fdfdfd98 dark:bg-#48484e98 backdrop-blur-sm mt-45px z-99 rounded-8px p-8px box-border">
          <n-scrollbar style="max-height: 120px" trigger="none">
            <n-flex
              vertical
              v-for="item in loginHistories"
              :key="item.account"
              @click="giveAccount(item)"
              class="p-8px cursor-pointer hover:bg-#90909020 dark:hover:bg-#90909030 hover:rounded-6px">
              <div class="flex-between-center">
                <n-avatar
                  :src="AvatarUtils.getAvatarUrl(item.avatar, item.uid)"
                  color="#fff"
                  class="size-28px rounded-50%" />
                <p class="text-14px color-#505050 dark:color-#fefefe">{{ item.account }}</p>
                <svg @click.stop="delAccount(item)" class="w-12px h-12px dark:color-#fefefe">
                  <title>{{ t('tooltip.remove_account') }}</title>
                  <use href="#close"></use>
                </svg>
              </div>
            </n-flex>
          </n-scrollbar>
        </div>

        <n-input
          maxlength="128"
          minlength="6"
          size="large"
          show-password-on="click"
          v-model:value="info.password"
          type="password"
          spellCheck="false"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          :placeholder="passwordPH"
          @focus="passwordPH = ''"
          @blur="passwordPH = t('login.input.pass.placeholder')"
          clearable />

        <!-- 两步验证码：服务端要求时才显示 -->
        <n-input
          v-if="mfaRequired"
          maxlength="32"
          size="large"
          v-model:value="info.code"
          type="text"
          spellCheck="false"
          autoComplete="one-time-code"
          autoCorrect="off"
          autoCapitalize="off"
          :placeholder="t('login.input.code.placeholder')"
          @keyup.enter="normalLogin('PC', true, false)"
          clearable />

        <n-button
          :loading="loading"
          :disabled="loginDisabled"
          color="#034fbc"
          text-color="#ffffff"
          class="login-submit w-full"
          @click="normalLogin('PC', true, false)">
          <span>{{ loginText }}</span>
        </n-button>
      </n-flex>
    </n-flex>

    <!-- 自动登录样式 -->
    <n-flex v-else-if="uiState === 'auto'" vertical :size="28" class="login-auto" data-tauri-drag-region>
      <n-flex :size="18" vertical align="center">
        <!-- 头像 -->
        <n-flex justify="center">
          <n-avatar
            round
            class="login-avatar"
            :size="88"
            :color="themes.content === ThemeEnum.DARK ? '#282828' : '#fff'"
            :fallback-src="themes.content === ThemeEnum.DARK ? '/avatar-dark.svg' : '/avatar-light.svg'"
            :src="AvatarUtils.getAvatarUrl(userStore.userInfo?.avatar, userStore.userInfo?.uid)" />
        </n-flex>

        <n-flex justify="center">
          <n-ellipsis style="max-width: 240px" class="login-name">
            {{ userStore.userInfo?.name || '' }}
          </n-ellipsis>
        </n-flex>
      </n-flex>

      <n-flex justify="center">
        <n-button
          :loading="loading"
          :disabled="loginDisabled"
          color="#034fbc"
          text-color="#ffffff"
          class="login-submit w-260px"
          @click="triggerAutoLogin">
          <span>{{ loginText }}</span>
        </n-button>
      </n-flex>
    </n-flex>

    <!-- 第三方登录 -->
    <div v-if="uiState !== 'auto' && ACCOUNT_FEATURES.thirdPartyLogin" class="w-full pb-22px pt-3px">
      <ThirdPartyLogin :login-context="loginContext" />
    </div>

    <!-- 底部操作栏 -->
    <div v-if="uiState === 'auto'" class="login-footer" id="bottomBar">
      <button type="button" class="login-footer-action" :title="cancelLoginTitle" @click="cancelAutoLoginAndShowManual">
        {{ cancelLoginLabel }}
      </button>
      <div class="login-footer-divider" aria-hidden="true"></div>
      <button type="button" class="login-footer-action" :title="removeAccountTitle" @click="removeStoredAccount">
        {{ removeAccountLabel }}
      </button>
    </div>
    <div v-else class="login-footer" id="bottomBar">
      <button
        type="button"
        v-if="ACCOUNT_FEATURES.qrCodeLogin"
        class="login-footer-action"
        :title="qrCodeTitle"
        @click="router.push('/qrCode')">
        {{ qrCodeLabel }}
      </button>
      <div v-if="ACCOUNT_FEATURES.qrCodeLogin" class="login-footer-divider" aria-hidden="true"></div>
      <div class="justify-self-start text-left">
        <n-popover
          trigger="click"
          id="moreShow"
          class="bg-#fdfdfd98! dark:bg-#48484e98! backdrop-blur-sm"
          v-model:show="moreShow"
          :show-checkmark="false"
          :show-arrow="false">
          <template #trigger>
            <button type="button" class="login-footer-action" :title="moreTitle">{{ moreLabel }}</button>
          </template>
          <n-flex vertical :size="2">
            <div
              v-if="ACCOUNT_FEATURES.selfRegister"
              class="register text-14px cursor-pointer hover:bg-#90909030 hover:rounded-6px p-8px"
              @click="createWebviewWindow('注册', 'register', 600, 600)">
              {{ t('login.register') }}
            </div>
            <div
              class="text-14px cursor-pointer hover:bg-#90909030 hover:rounded-6px p-8px"
              @click="createWebviewWindow('忘记密码', 'forgetPassword', 600, 600)">
              {{ t('login.option.items.forget') }}
            </div>
            <div
              v-if="!isCompatibility()"
              @click="router.push('/network')"
              :class="{ network: isMac() }"
              class="text-14px cursor-pointer hover:bg-#90909030 hover:rounded-6px p-8px">
              {{ t('login.option.items.network_setting') }}
            </div>
          </n-flex>
        </n-popover>
      </div>
    </div>
  </n-config-provider>
</template>
<script setup lang="ts">
import BrandLogo from '@/components/common/BrandLogo.vue'
import { useI18n } from 'vue-i18n'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { useNetwork } from '@vueuse/core'
import { darkTheme, lightTheme } from 'naive-ui'
import { storeToRefs } from 'pinia'
import { useCheckUpdate } from '@/hooks/useCheckUpdate'
import { useMitt } from '@/hooks/useMitt'
import { useWindow } from '@/hooks/useWindow.ts'
import router from '@/router'
import type { UserInfoType } from '@/services/types.ts'
import { WsResponseMessageType } from '@/services/wsType'
import { useGlobalStore } from '@/stores/global'
import { useLoginHistoriesStore } from '@/stores/loginHistory.ts'
import { useSettingStore } from '@/stores/setting.ts'
import { useUserStore } from '@/stores/user.ts'
import { AvatarUtils } from '@/utils/AvatarUtils'
import { isCompatibility, isDesktop, isMac, isWeb } from '@/utils/PlatformConstants'
import { clearDesktopLogin, hasValidDesktopLogin } from '@/utils/DesktopLoginSession'
import { clearLoginSecrets } from '@/utils/LoginSecrets'
import { clearListener } from '@/utils/ReadCountQueue'
import { useLogin } from '@/hooks/useLogin'
import { formatBottomText } from '@/utils/Formatting'
import { ThemeEnum } from '@/enums'
import ThirdPartyLogin, { type ThirdPartyLoginContext } from './ThirdPartyLogin.vue'
import { ACCOUNT_FEATURES } from '@/common/backend'
import { ImUrlEnum } from '@/enums'
import { imRequestSilent } from '@/utils/ImRequestUtils'
import {
  completeLoginAccount,
  LOGIN_DOMAIN_STORAGE_KEY,
  loginAccountSuffix,
  normalizeLoginDomain,
  shortLoginName
} from '@/utils/LoginAccountUtils'

const { t } = useI18n()

const settingStore = useSettingStore()
const { themes } = storeToRefs(settingStore)
const naiveTheme = computed(() => (themes.value.content === 'dark' ? darkTheme : lightTheme))
const userStore = useUserStore()
const globalStore = useGlobalStore()
const { isTrayMenuShow } = storeToRefs(globalStore)
/** 网络连接是否正常 */
const { isOnline } = useNetwork()
const loginHistoriesStore = useLoginHistoriesStore()
const { loginHistories } = loginHistoriesStore
const { login } = storeToRefs(settingStore)
const arrowStatus = ref(false)
const moreShow = ref(false)
const { createWebviewWindow, createModalWindow, getWindowPayload } = useWindow()
const { checkUpdate, CHECK_UPDATE_LOGIN_TIME } = useCheckUpdate()
const {
  normalLogin,
  giteeLogin,
  githubLogin,
  gitcodeLogin,
  loading,
  loginText,
  loginDisabled,
  info,
  uiState,
  mfaRequired
} = useLogin()
const loginContext: ThirdPartyLoginContext = {
  giteeLogin,
  githubLogin,
  gitcodeLogin,
  loading,
  loginDisabled
}
const isDesktopClient = isDesktop()
const AUTO_LOGIN_DELAY_MS = 3000
const autoLoginPending = ref(false)
let autoLoginTimer: number | null = null

const clearAutoLoginTimer = () => {
  if (autoLoginTimer !== null) {
    window.clearTimeout(autoLoginTimer)
    autoLoginTimer = null
  }
  autoLoginPending.value = false
}

const startAutoLoginCountdown = () => {
  if (!isDesktopClient) {
    normalLogin('PC', true, true)
    return
  }
  clearAutoLoginTimer()
  autoLoginPending.value = true
  autoLoginTimer = window.setTimeout(() => {
    autoLoginPending.value = false
    autoLoginTimer = null
    normalLogin('PC', true, true)
  }, AUTO_LOGIN_DELAY_MS)
}

/** 登录窗口发现新版本时直接安装；正在登录就不打断，登录后由主窗口后台下载 */
const canInstallUpdate = () => {
  if (loading.value) {
    return false
  }
  clearAutoLoginTimer()
  return true
}

const cancelAutoLogin = () => {
  if (!autoLoginPending.value) {
    return
  }
  clearAutoLoginTimer()
}

const handleAutoLoginActivity = () => {
  if (uiState.value !== 'auto' || !autoLoginPending.value) {
    return
  }
  cancelAutoLogin()
}

const triggerAutoLogin = () => {
  cancelAutoLogin()
  normalLogin('PC', true, true)
}

const cancelAutoLoginAndShowManual = () => {
  cancelAutoLogin()
  uiState.value = 'manual'
  loginHistories.length > 0 && giveAccount(loginHistories[0])
}

/** 登录域名（如 smjtools.com）：账号框只输用户名，域名显示在右侧，服务端补全 */
const loginDomain = ref(normalizeLoginDomain(localStorage.getItem(LOGIN_DOMAIN_STORAGE_KEY)))
const accountSuffix = computed(() => loginAccountSuffix(info.value.account || '', loginDomain.value))

const loadLoginDomain = async () => {
  const config = await imRequestSilent<{ loginDomain?: string | null }>({ url: ImUrlEnum.INIT_CONFIG })
  if (!config) return
  const domain = normalizeLoginDomain(config.loginDomain)
  loginDomain.value = domain
  if (domain) {
    localStorage.setItem(LOGIN_DOMAIN_STORAGE_KEY, domain)
  } else {
    localStorage.removeItem(LOGIN_DOMAIN_STORAGE_KEY)
  }
}

// 域名后到时，把已填入的完整地址收成用户名
watch(loginDomain, (domain) => {
  if (info.value.account) {
    info.value.account = shortLoginName(info.value.account, domain)
  }
})

// 输入框占位符
const accountPH = ref(t('login.input.account.placeholder'))
const passwordPH = ref(t('login.input.pass.placeholder'))

// 底部操作栏多语言超过6个字符时显示省略号
const MAX_BOTTOM_TEXT_LEN = 6
const qrCodeText = computed(() => t('login.button.qr_code'))
const moreText = computed(() => t('login.option.more'))
const removeAccountText = computed(() => t('login.button.remove_account'))
const cancelLoginText = computed(() => t('login.button.cancel_login'))
const qrCodeLabel = computed(() => formatBottomText(qrCodeText.value, MAX_BOTTOM_TEXT_LEN))
const moreLabel = computed(() => formatBottomText(moreText.value, MAX_BOTTOM_TEXT_LEN))
const removeAccountLabel = computed(() => formatBottomText(removeAccountText.value, MAX_BOTTOM_TEXT_LEN))
const cancelLoginLabel = computed(() => formatBottomText(cancelLoginText.value, MAX_BOTTOM_TEXT_LEN))
const qrCodeTitle = computed(() => (qrCodeLabel.value !== qrCodeText.value ? qrCodeText.value : undefined))
const moreTitle = computed(() => (moreLabel.value !== moreText.value ? moreText.value : undefined))
const removeAccountTitle = computed(() =>
  removeAccountLabel.value !== removeAccountText.value ? removeAccountText.value : undefined
)
const cancelLoginTitle = computed(() =>
  cancelLoginLabel.value !== cancelLoginText.value ? cancelLoginText.value : undefined
)

/** 是否直接跳转 */
const isJumpDirectly = ref(false)

// 导入Web Worker
const timerWorker = new Worker(new URL('../../workers/timer.worker.ts', import.meta.url))

// 添加错误处理
timerWorker.onerror = (error) => {
  console.error('[Worker Error]', error)
}

// 监听 Worker 消息
timerWorker.onmessage = (e) => {
  const { type } = e.data
  if (type === 'timeout') {
    checkUpdate('login', canInstallUpdate)
  }
}

watchEffect(() => {
  if (uiState.value === 'auto') {
    loginDisabled.value = !isOnline.value || !userStore.userInfo?.account
    return
  }
  loginDisabled.value = !(info.value.account && info.value.password && isOnline.value)
})

watch(
  () => uiState.value,
  (state) => {
    if (state !== 'auto') {
      clearAutoLoginTimer()
    }
  }
)

watch(
  () => login.value.autoLogin,
  (isAuto) => {
    if (!isAuto) {
      clearAutoLoginTimer()
    }
  }
)

watch(isOnline, (v) => {
  loginDisabled.value = !v
  loginText.value = v ? t('login.button.login.default') : t('login.button.login.network_error')
})

// 监听账号输入
watch(
  () => info.value.account,
  (newAccount) => {
    if (!newAccount) {
      info.value.avatar = '/avatar-light.svg'
      return
    }

    // 在登录历史中查找匹配的账号
    const fullAccount = completeLoginAccount(newAccount, loginDomain.value)
    const matchedAccount = loginHistories.find(
      (history) => history.account === fullAccount || history.email === fullAccount
    )
    if (matchedAccount) {
      info.value.avatar = matchedAccount.avatar
    } else {
      info.value.avatar = '/avatar-light.svg'
    }
  }
)

const openRemoteLoginModal = async (ip?: string) => {
  if (!isDesktop()) {
    return
  }
  const payloadIp = ip ?? '未知IP'
  await createModalWindow(
    '异地登录提醒',
    'modal-remoteLogin',
    350,
    310,
    'login',
    {
      ip: payloadIp
    },
    {
      minWidth: 350,
      minHeight: 310
    }
  )
}

const handlePendingRemoteLoginPayload = async () => {
  if (!isDesktop()) {
    return
  }
  try {
    const payload = await getWindowPayload<{ remoteLogin?: { ip?: string } }>('login')
    if (payload?.remoteLogin) {
      openRemoteLoginModal(payload.remoteLogin.ip)
    }
  } catch (error) {
    console.error('处理异地登录载荷失败:', error)
  }
}

/** 删除账号列表内容 */
const delAccount = (item: UserInfoType) => {
  // 获取删除前账户列表的长度
  const lengthBeforeDelete = loginHistories.length
  loginHistoriesStore.removeLoginHistory(item)
  // 判断是否删除了最后一个条目，并据此更新arrowStatus
  if (lengthBeforeDelete === 1 && loginHistories.length === 0) {
    arrowStatus.value = false
  }
  info.value.account = ''
  info.value.password = ''
  info.value.avatar = '/avatar-light.svg'
}

/**
 * 给账号赋值
 * @param item 账户信息
 * */
const giveAccount = (item: UserInfoType) => {
  const { account, password, avatar, name, uid } = item
  info.value.account = shortLoginName(account || '', loginDomain.value)
  info.value.password = isDesktopClient && !isWeb() ? '' : password || ''
  info.value.avatar = avatar
  info.value.name = name
  info.value.uid = uid
  arrowStatus.value = false
}

/** 移除已登录账号 */
const removeStoredAccount = () => {
  const storedUserInfo = userStore.userInfo
  if (storedUserInfo) {
    if (isDesktop() && !isWeb()) clearDesktopLogin(storedUserInfo.uid)
    const matchedHistory = loginHistories.find(
      (item) => item.uid === storedUserInfo.uid || item.account === storedUserInfo.account
    )
    if (matchedHistory) {
      loginHistoriesStore.removeLoginHistory(matchedHistory)
    }
  }
  localStorage.removeItem('TOKEN')
  localStorage.removeItem('REFRESH_TOKEN')
  userStore.userInfo = undefined
  cancelAutoLoginAndShowManual()
}

const closeMenu = (event: MouseEvent) => {
  const target = event.target as Element
  if (!target.matches('.account-box, .account-box *, .down')) {
    arrowStatus.value = false
  }
  if (!target.matches('#moreShow')) {
    moreShow.value = false
  }
}

const enterKey = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !loginDisabled.value) {
    normalLogin('PC', true, false)
  }
}

onBeforeMount(async () => {
  if (isDesktopClient && !isWeb()) {
    for (const history of loginHistories) clearLoginSecrets(history)
    if (userStore.userInfo) clearLoginSecrets(userStore.userInfo)
  }
  // 登录页初始化时清空当前会话，避免重启后默认选中旧会话
  globalStore.updateCurrentSessionRoomId('')
  await handlePendingRemoteLoginPayload()
  // 始终初始化托盘菜单状态为false
  isTrayMenuShow.value = false

  if (!login.value.autoLogin || (isDesktopClient && !isWeb() && !hasValidDesktopLogin(userStore.userInfo?.uid))) {
    // 非自动登录模式，直接显示手动登录界面
    uiState.value = 'manual'
    localStorage.removeItem('TOKEN')
    localStorage.removeItem('REFRESH_TOKEN')
    clearListener()
    return
  }
})

onMounted(async () => {
  // 只有在需要登录的情况下才显示登录窗口
  if (!isJumpDirectly.value) {
    await getCurrentWebviewWindow().show()
  }

  useMitt.on(WsResponseMessageType.NO_INTERNET, () => {
    loginDisabled.value = true
    loginText.value = t('login.status.service_disconnected')
  })

  // 自动登录时显示自动登录界面并触发登录
  if (login.value.autoLogin && (!isDesktopClient || isWeb() || hasValidDesktopLogin(userStore.userInfo?.uid))) {
    uiState.value = 'auto'
    startAutoLoginCountdown()
  } else {
    // 手动登录模式，自动填充第一个历史账号
    uiState.value = 'manual'
    loginHistories.length > 0 && giveAccount(loginHistories[0])
  }

  void loadLoginDomain()
  window.addEventListener('click', closeMenu, true)
  window.addEventListener('keyup', enterKey)
  if (isDesktopClient) {
    window.addEventListener('pointerdown', handleAutoLoginActivity, true)
    window.addEventListener('keydown', handleAutoLoginActivity, true)
  }
  await checkUpdate('login', canInstallUpdate)
  timerWorker.postMessage({
    type: 'startTimer',
    msgId: 'checkUpdate',
    duration: CHECK_UPDATE_LOGIN_TIME
  })
})

onUnmounted(() => {
  window.removeEventListener('click', closeMenu, true)
  window.removeEventListener('keyup', enterKey)
  if (isDesktopClient) {
    window.removeEventListener('pointerdown', handleAutoLoginActivity, true)
    window.removeEventListener('keydown', handleAutoLoginActivity, true)
  }
  clearAutoLoginTimer()
  // 清除Web Worker计时器
  timerWorker.postMessage({
    type: 'clearTimer',
    msgId: 'checkUpdate'
  })
  timerWorker.terminate()
})
</script>

<style scoped lang="scss">
@use '@/styles/scss/login';

.login-box {
  display: flex;
  flex-direction: column;
  overflow: auto;
  background: #f7f9fc;
  color: #172b4d;
}

.login-header {
  flex: none;
  background: #034fbc;
  --action-bar-icon-color: #ffffff;
}

.login-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 76px;
}

.login-logo {
  display: block;
  width: 108px;
  height: auto;
}

.login-manual {
  flex: none;
  padding: 16px 30px 8px;
}

.login-form {
  position: relative;
  width: 100%;
}

.login-avatar {
  outline: 4px solid #ffffff;
  box-shadow: 0 2px 12px #0a1f5414;
}

.login-auto {
  flex: 1;
  justify-content: center;
  padding: 28px 30px;
}

.login-name {
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
}

.login-submit {
  height: 42px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
}

:deep(.n-input) {
  border-radius: 8px;
  text-align: left;
}

:deep(.n-input .n-input__input, .n-input .n-input__textarea) {
  margin-left: 0;
}

.login-footer {
  display: flex;
  flex: none;
  justify-content: center;
  align-items: center;
  gap: 14px;
  margin-top: auto;
  padding: 6px 20px 20px;
}

.login-footer-action {
  padding: 4px 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #52647e;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;

  &:hover {
    color: #034fbc;
  }

  &:focus-visible {
    outline: 2px solid #034fbc;
    outline-offset: 3px;
  }
}

.login-footer-divider {
  width: 1px;
  height: 12px;
  background: #d7dfeb;
}

html[data-theme='dark'] .login-box {
  background: #151d28;
  color: #e6edf7;
}

html[data-theme='dark'] .login-avatar {
  outline-color: #263345;
}

html[data-theme='dark'] .login-footer-action {
  color: #b7c5d8;

  &:hover {
    color: #ffffff;
  }

  &:focus-visible {
    outline-color: #8dbbfa;
  }
}

html[data-theme='dark'] .login-footer-divider {
  background: #41516a;
}
</style>
