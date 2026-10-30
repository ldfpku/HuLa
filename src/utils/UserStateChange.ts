export async function changeOwnUserState(
  id: string,
  actions: {
    currentAccount: () => string | undefined
    change: (id: string) => Promise<unknown>
    readCurrent: () => Promise<{ uid: string; userStateId: string }>
    apply: (id: string) => void
    isCurrent: () => boolean
    accountChangedMessage: string
  }
): Promise<boolean> {
  const account = actions.currentAccount()
  if (!account) throw new Error(actions.accountChangedMessage)
  try {
    await actions.change(id)
  } catch (error) {
    if (actions.isCurrent() && actions.currentAccount() === account) {
      void actions
        .readCurrent()
        .then((current) => {
          if (actions.isCurrent() && actions.currentAccount() === account && current.uid === account)
            actions.apply(current.userStateId)
        })
        .catch((refreshError) => console.error('刷新用户状态失败:', refreshError))
    }
    throw error
  }
  if (!actions.isCurrent()) return false
  if (actions.currentAccount() !== account) throw new Error(actions.accountChangedMessage)
  actions.apply(id === '0' ? '1' : id)
  return true
}

export function userStateChangeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}
