export async function guardedLogout(actions: {
  prepare: () => Promise<boolean>
  release: () => Promise<void>
  logout: () => Promise<void>
}): Promise<void> {
  const locked = await actions.prepare()
  try {
    await actions.logout()
  } catch (error) {
    if (locked) {
      try {
        await actions.release()
      } catch (releaseError) {
        throw new AggregateError([error, releaseError], '退出登录失败，恢复邮件操作也失败')
      }
    }
    throw error
  }
}
