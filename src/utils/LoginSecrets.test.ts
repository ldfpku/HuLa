import { describe, expect, it } from 'vitest'
import { clearLoginSecrets } from './LoginSecrets'

describe('desktop login secrets', () => {
  it('removes legacy credentials without changing account identity', () => {
    const account = { uid: 'a', password: 'password', token: 'access', refreshToken: 'refresh' }
    clearLoginSecrets(account)
    expect(account).toEqual({ uid: 'a' })
  })
})
