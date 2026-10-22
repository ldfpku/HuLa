import { describe, expect, it } from 'vitest'
import { completeLoginAccount, loginAccountSuffix, normalizeLoginDomain, shortLoginName } from './LoginAccountUtils'

describe('LoginAccountUtils', () => {
  it('用户名补全登录域名，完整地址原样保留', () => {
    expect(completeLoginAccount(' liss ', 'smjtools.com')).toBe('liss@smjtools.com')
    expect(completeLoginAccount('liss@smjtools.com', 'smjtools.com')).toBe('liss@smjtools.com')
    expect(completeLoginAccount('a@other.example', 'smjtools.com')).toBe('a@other.example')
    expect(completeLoginAccount('liss', '')).toBe('liss')
  })

  it('登录域名下的地址显示为用户名', () => {
    expect(shortLoginName('liss@smjtools.com', 'smjtools.com')).toBe('liss')
    expect(shortLoginName('liss@SMJtools.com', 'smjtools.com')).toBe('liss')
    expect(shortLoginName('a@other.example', 'smjtools.com')).toBe('a@other.example')
    expect(shortLoginName('liss@smjtools.com', '')).toBe('liss@smjtools.com')
  })

  it('输入 @ 后不再显示后缀', () => {
    expect(loginAccountSuffix('liss', 'smjtools.com')).toBe('@smjtools.com')
    expect(loginAccountSuffix('liss@', 'smjtools.com')).toBe('')
    expect(loginAccountSuffix('liss', '')).toBe('')
  })

  it('规范化服务端返回的域名', () => {
    expect(normalizeLoginDomain(' @SMJtools.com ')).toBe('smjtools.com')
    expect(normalizeLoginDomain(null)).toBe('')
  })
})
