import { defineStore } from 'pinia'
import { PluginEnum, StoresEnum } from '@/enums'
import { useI18n } from 'vue-i18n'
import { useMailStore } from '@/stores/mail'
import { useTodoStore } from '@/stores/todo'

export const useMenuTopStore = defineStore(
  StoresEnum.MENUTOP,
  () => {
    const { t } = useI18n()
    const mailStore = useMailStore()
    const todoStore = useTodoStore()
    // 初始配置，文案由 i18n 动态注入，确保语言切换实时更新
    const baseMenuTop: Array<Omit<STO.Plugins<PluginEnum>, 'title' | 'shortTitle'>> = [
      {
        url: 'message',
        icon: 'message',
        iconAction: 'message-action',
        state: PluginEnum.BUILTIN,
        isAdd: true,
        dot: false,
        progress: 0,
        miniShow: false
      },
      {
        url: 'friendsList',
        icon: 'avatar',
        iconAction: 'avatar-action',
        state: PluginEnum.BUILTIN,
        isAdd: true,
        dot: false,
        progress: 0,
        miniShow: false
      },
      {
        url: 'mail',
        icon: 'mail',
        iconAction: 'mail-action',
        state: PluginEnum.BUILTIN,
        isAdd: true,
        dot: false,
        progress: 0,
        miniShow: false
      },
      {
        url: 'todo',
        icon: 'list-checkbox',
        iconAction: 'list-checkbox',
        state: PluginEnum.BUILTIN,
        isAdd: true,
        dot: false,
        progress: 0,
        miniShow: false
      }
    ]

    const menuTop = computed<STO.Plugins<PluginEnum>[]>(() => [
      {
        ...baseMenuTop[0],
        title: t('home.action.message'),
        shortTitle: t('home.action.message_short_title')
      },
      {
        ...baseMenuTop[1],
        title: t('home.action.contact'),
        shortTitle: t('home.action.contact_short_title')
      },
      {
        ...baseMenuTop[2],
        title: t('home.action.mail'),
        shortTitle: t('home.action.mail_short_title'),
        badge: mailStore.unreadCount || undefined
      },
      {
        ...baseMenuTop[3],
        title: t('home.action.todo'),
        shortTitle: t('home.action.todo_short_title'),
        // 已过期和今天到期的待办
        badge: todoStore.dueCount || undefined
      }
    ])

    return {
      menuTop
    }
  },
  {
    share: {
      enable: true,
      initialize: true
    }
  }
)
