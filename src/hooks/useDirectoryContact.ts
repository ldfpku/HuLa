import { useI18n } from 'vue-i18n'
import { useContactStore } from '@/stores/contacts'

export const useDirectoryContact = () => {
  const { t } = useI18n()
  const contactStore = useContactStore()

  const refreshDirectoryContact = async (uid: string) => {
    const result = await contactStore.refreshDirectoryContact(uid)
    if (result === 'failed') window.$message.error(t('message.directory_contact.refresh_failed'))
    if (result === 'missing') window.$message.warning(t('message.directory_contact.unavailable'))
    return result === 'found'
  }

  return { refreshDirectoryContact }
}
