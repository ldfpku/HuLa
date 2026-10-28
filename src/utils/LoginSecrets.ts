export const clearLoginSecrets = (account: { password?: string; token?: string; refreshToken?: string }) => {
  delete account.password
  delete account.token
  delete account.refreshToken
}
