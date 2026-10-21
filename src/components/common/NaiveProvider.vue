<template>
  <n-config-provider
    :theme-overrides="themes.content === ThemeEnum.DARK ? darkThemeOverrides : lightThemeOverrides"
    :theme="globalTheme"
    :locale="currentNaiveLocale"
    :date-locale="currentNaiveDateLocale">
    <n-loading-bar-provider>
      <n-dialog-provider>
        <n-notification-provider :max="notificMax">
          <n-message-provider :max="messageMax">
            <n-modal-provider>
              <slot></slot>
              <naive-provider-content />
            </n-modal-provider>
          </n-message-provider>
        </n-notification-provider>
      </n-dialog-provider>
    </n-loading-bar-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  darkTheme,
  dateEnUS,
  dateKoKR,
  dateZhCN,
  enUS,
  type GlobalThemeOverrides,
  type NDateLocale,
  type NLocale,
  koKR,
  lightTheme,
  zhCN
} from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { ThemeEnum } from '@/enums'
import { useSettingStore } from '@/stores/setting.ts'

const { notificMax, messageMax } = defineProps<{
  notificMax?: number
  messageMax?: number
}>()
defineOptions({ name: 'NaiveProvider' })
const settingStore = useSettingStore()
const { themes } = storeToRefs(settingStore)
const { locale } = useI18n()

type NaiveLocalePack = {
  locale: NLocale
  dateLocale: NDateLocale
}

const naiveLocaleMap: Record<string, NaiveLocalePack> = {
  'zh-CN': { locale: zhCN, dateLocale: dateZhCN },
  zh: { locale: zhCN, dateLocale: dateZhCN },
  'en-US': { locale: enUS, dateLocale: dateEnUS },
  en: { locale: enUS, dateLocale: dateEnUS },
  'ko-KR': { locale: koKR, dateLocale: dateKoKR },
  ko: { locale: koKR, dateLocale: dateKoKR }
}

const defaultNaiveLocalePack = naiveLocaleMap['zh-CN']
const resolveNaiveLocale = (lang: string): NaiveLocalePack => naiveLocaleMap[lang] ?? defaultNaiveLocalePack
const currentNaiveLocale = computed(() => resolveNaiveLocale(locale.value).locale)
const currentNaiveDateLocale = computed(() => resolveNaiveLocale(locale.value).dateLocale)
/**监听深色主题颜色变化*/
const globalTheme = ref<any>(themes.value.content === ThemeEnum.DARK ? darkTheme : lightTheme)
const prefers = matchMedia('(prefers-color-scheme: dark)')
// 定义不需要显示消息提示的窗口
const noMessageWindows = ['tray', 'notify', 'capture', 'update', 'checkupdate']

const isValidContent = (theme?: string): theme is ThemeEnum => theme === ThemeEnum.DARK || theme === ThemeEnum.LIGHT

const applyThemeContent = (theme: ThemeEnum) => {
  globalTheme.value = theme === ThemeEnum.DARK ? darkTheme : lightTheme
  document.documentElement.dataset.theme = theme
  console.log(globalTheme.value)
}

const syncOsTheme = () => {
  if (themes.value.pattern !== ThemeEnum.OS) return
  settingStore.syncOsTheme()
}

const handlePrefersChange = () => {
  syncOsTheme()
}

let prefersListenerAttached = false
const attachPrefersListener = () => {
  if (prefersListenerAttached) return
  prefers.addEventListener('change', handlePrefersChange)
  prefersListenerAttached = true
}

const detachPrefersListener = () => {
  if (!prefersListenerAttached) return
  prefers.removeEventListener('change', handlePrefersChange)
  prefersListenerAttached = false
}

watch(
  () => themes.value.pattern,
  (pattern) => {
    if (pattern === ThemeEnum.OS) {
      syncOsTheme()
      attachPrefersListener()
      return
    }
    detachPrefersListener()
    settingStore.normalizeThemeState()
  },
  { immediate: true }
)

watch(
  () => themes.value.content,
  (content) => {
    if (!isValidContent(content)) {
      settingStore.normalizeThemeState()
      return
    }
    applyThemeContent(content)
  },
  { immediate: true }
)

onUnmounted(() => {
  detachPrefersListener()
})

// BIS v1.7：直角扁平（控件 2px、卡片与浮层 4px）、斯米伽蓝为主色、信号橙不进组件色，见 brand/bis-frontend-guide.md
const commonTheme: GlobalThemeOverrides = {
  common: {
    primaryColor: '#034fbc',
    primaryColorHover: '#03419b',
    primaryColorPressed: '#06327a',
    primaryColorSuppl: '#034fbc',
    infoColor: '#4170cb',
    infoColorHover: '#034fbc',
    infoColorPressed: '#06327a',
    infoColorSuppl: '#4170cb',
    warningColor: '#a95400',
    warningColorHover: '#a95400',
    warningColorPressed: '#a95400',
    warningColorSuppl: '#a95400',
    errorColor: '#c14053',
    errorColorHover: '#c14053',
    errorColorPressed: '#a3334a',
    errorColorSuppl: '#c14053',
    borderRadius: '4px',
    borderRadiusSmall: '2px'
  },
  // 未读数用斯米伽蓝，红色只留给危险操作
  Badge: {
    color: '#034fbc'
  },
  Input: {
    borderRadius: '2px',
    borderHover: '0',
    // TODO: 不清楚为什么去掉边框
    // border: '0',
    borderDisabled: '0',
    borderFocus: '0',
    boxShadowFocus: '0'
  },
  Checkbox: {
    colorChecked: '#034fbc',
    borderChecked: '1px solid #034fbc',
    borderFocus: '1px solid #034fbc',
    boxShadowFocus: '0 0 0 2px rgba(3, 79, 188, 0.3)'
  },
  Tag: {
    borderRadius: '2px'
  },
  Button: {
    borderRadiusLarge: '2px',
    borderRadiusMedium: '2px',
    borderRadiusSmall: '2px',
    borderRadiusTiny: '2px',
    colorPrimary: '#034fbc'
  },
  Tabs: {
    tabTextColorSegment: '#636c7e',
    tabPaddingMediumSegment: '4px',
    tabBorderRadius: '2px',
    tabTextColorActiveLine: '#034fbc',
    tabTextColorHoverLine: '#034fbc',
    tabTextColorActiveBar: '#034fbc',
    tabTextColorHoverBar: '#034fbc',
    barColor: '#034fbc'
  },
  Popover: {
    padding: '5px',
    borderRadius: '4px'
  },
  Dropdown: {
    borderRadius: '4px',
    optionBorderRadius: '2px'
  },
  Card: {
    borderRadius: '4px'
  },
  Dialog: {
    borderRadius: '4px'
  },
  Avatar: {
    border: '1px solid #fff'
  },
  Switch: {
    railColorActive: '#034fbc',
    loadingColor: '#034fbc',
    boxShadowFocus: '0 0 0 2px rgba(3, 79, 188, 0.3)'
  },
  Radio: {
    boxShadowActive: 'inset 0 0 0 1px #034fbc',
    boxShadowFocus: 'inset 0 0 0 1px #034fbc,0 0 0 2px rgba(3, 79, 188, 0.3)',
    boxShadowHover: 'inset 0 0 0 1px #034fbc',
    dotColorActive: '#034fbc',
    buttonBorderRadius: '2px'
  },
  Message: {
    iconColorSuccess: '#034fbc',
    iconColorLoading: '#034fbc',
    loadingColor: '#034fbc',
    borderRadius: '4px'
  },
  Slider: {
    handleSize: '12px',
    fontSize: '10px',
    markFontSize: '8px',
    fillColor: '#034fbc',
    fillColorHover: '#034fbc',
    indicatorBorderRadius: '4px'
  },
  Notification: {
    borderRadius: '4px'
  },
  Steps: {
    indicatorBorderColorProcess: '#034fbc',
    indicatorColorProcess: '#4170cb'
  },
  LoadingBar: {
    colorLoading: '#034fbc'
  }
}

/** 浅色模式的主题颜色 */
const lightThemeOverrides: GlobalThemeOverrides = {
  ...commonTheme,
  common: {
    ...commonTheme.common,
    textColorBase: '#0a1f54',
    textColor1: '#0a1f54',
    textColor2: '#2b3752',
    textColor3: '#636c7e',
    placeholderColor: '#8a93a3',
    borderColor: '#dce1ea',
    dividerColor: '#dce1ea',
    hoverColor: '#f2f5fa',
    actionColor: '#f2f5fa',
    bodyColor: '#e9edf5'
  },
  Empty: {
    iconColor: '#a9c2ee',
    textColor: '#636c7e'
  },
  Scrollbar: {
    color: '#c9cfda',
    colorHover: '#b7becb'
  },
  Skeleton: {
    color: '#e9edf5',
    colorEnd: '#f2f5fa'
  }
}

/** 深色模式的主题颜色：以深井蓝为基底（BIS B12），不用中性灰黑 */
const darkThemeOverrides: GlobalThemeOverrides = {
  ...commonTheme,
  common: {
    ...commonTheme.common,
    primaryColorHover: '#1d5fc9',
    primaryColorPressed: '#03419b',
    infoColor: '#7a9fe2',
    infoColorSuppl: '#7a9fe2',
    warningColor: '#f4c375',
    warningColorHover: '#f4c375',
    warningColorPressed: '#f4c375',
    warningColorSuppl: '#f4c375',
    errorColor: '#e8848f',
    errorColorHover: '#e8848f',
    errorColorSuppl: '#e8848f',
    textColorBase: '#ffffff',
    textColor1: '#ffffff',
    textColor2: '#e9edf5',
    textColor3: '#b7becb',
    placeholderColor: '#7f8aa3',
    borderColor: '#2b3752',
    dividerColor: '#2b3752',
    hoverColor: 'rgba(255, 255, 255, 0.06)',
    actionColor: '#13295f',
    bodyColor: '#071539',
    cardColor: '#0a1f54',
    modalColor: '#0a1f54',
    popoverColor: '#13295f',
    tableColor: '#0a1f54',
    tableHeaderColor: '#13295f',
    inputColor: '#13295f',
    tagColor: '#13295f',
    codeColor: '#13295f',
    tabColor: '#13295f'
  },
  Badge: {
    color: '#4170cb'
  },
  // SMJ Blue 在深色背景上作文字对比度不足，文字强调色改用 #7a9fe2
  Tabs: {
    ...commonTheme.Tabs,
    tabTextColorSegment: '#b7becb',
    tabTextColorActiveLine: '#7a9fe2',
    tabTextColorHoverLine: '#7a9fe2',
    tabTextColorActiveBar: '#7a9fe2',
    tabTextColorHoverBar: '#7a9fe2',
    barColor: '#7a9fe2'
  },
  Empty: {
    iconColor: '#3a4a6e',
    textColor: '#b7becb'
  },
  Scrollbar: {
    color: 'rgba(255, 255, 255, 0.2)',
    colorHover: 'rgba(255, 255, 255, 0.3)'
  },
  Skeleton: {
    color: '#13295f',
    colorEnd: '#0f2560'
  }
}

// 挂载naive组件的方法至window, 以便在路由钩子函数和请求函数里面调用
const registerNaiveTools = () => {
  window.$loadingBar = useLoadingBar()
  window.$dialog = useDialog()
  window.$notification = useNotification()
  window.$modal = useModal()

  // 获取原始的消息对象
  const originalMessage = useMessage()

  // 创建一个空的消息对象，用于禁用消息的窗口
  const noOpMessage = {
    info: () => {},
    success: () => {},
    warning: () => {},
    error: () => {},
    loading: () => ({
      destroy: () => {},
      type: 'loading'
    }),
    create: () => ({
      destroy: () => {},
      type: 'info'
    }),
    destroyAll: () => {}
  } as unknown as ReturnType<typeof useMessage>

  // 检查当前路由是否需要禁用消息
  const shouldDisableMessage = () => {
    return noMessageWindows.includes(getCurrentWebviewWindow().label)
  }

  // 设置消息对象
  window.$message = shouldDisableMessage() ? noOpMessage : originalMessage
}

const NaiveProviderContent = defineComponent({
  name: 'NaiveProviderContent',
  setup() {
    registerNaiveTools()
  },
  render() {
    return h('div')
  }
})
</script>
<style>
.n-popover {
  zoom: var(--page-scale, 1);
}

.n-dropdown-menu {
  zoom: var(--page-scale, 1);
}

.n-tooltip {
  zoom: var(--page-scale, 1);
}

.n-modal {
  zoom: var(--page-scale, 1);
}

.n-drawer {
  zoom: var(--page-scale, 1);
}

.n-notification {
  zoom: var(--page-scale, 1);
}

.n-message {
  zoom: var(--page-scale, 1);
}

.n-date-picker-panel {
  zoom: var(--page-scale, 1);
}

.n-time-picker-panel {
  zoom: var(--page-scale, 1);
}

.n-cascader-menu {
  zoom: var(--page-scale, 1);
}

.n-select-menu {
  zoom: var(--page-scale, 1);
}

.n-popselect {
  zoom: var(--page-scale, 1);
}

.n-popselect-panel {
  zoom: var(--page-scale, 1);
}

.n-base-select-menu {
  zoom: var(--page-scale, 1);
}
</style>
