import { defineStore } from 'pinia'
import { StoresEnum } from '@/enums'
import { desktopMailTarget } from '@/utils/DesktopMail'

export type MainWorkspace = 'chat' | 'mail' | 'todo'
export type MailNavigation = { id: number; target: string }

export const useWorkspaceStore = defineStore(
  StoresEnum.WORKSPACE,
  () => {
    const active = ref<MainWorkspace>('chat')
    const mailNavigation = ref<MailNavigation | null>(null)
    const sidebarMenuOpen = ref(false)

    const openChat = () => {
      active.value = 'chat'
    }

    const openMail = (path?: string) => {
      const target = path === undefined ? null : desktopMailTarget(path)
      if (target) mailNavigation.value = { id: (mailNavigation.value?.id ?? 0) + 1, target }
      active.value = 'mail'
    }

    const openTodo = () => {
      active.value = 'todo'
    }

    const reset = () => {
      active.value = 'chat'
      mailNavigation.value = null
      sidebarMenuOpen.value = false
    }

    return { active, mailNavigation, sidebarMenuOpen, openChat, openMail, openTodo, reset }
  },
  {
    share: {
      enable: true,
      initialize: true
    }
  }
)
