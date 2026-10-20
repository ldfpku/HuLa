import { describe, expect, it } from 'vitest'
import { matchDirectoryPerson, mergeDirectoryPeople, type DirectoryPerson } from './DirectorySearch'

const person = (uid: string, name: string, account: string): DirectoryPerson => ({ uid, name, account, avatar: '' })

describe('DirectorySearch', () => {
  it('按姓名、邮箱前缀匹配，只输域名不匹配', () => {
    const xia = person('u1', '王小霞', 'wangxx@smjtools.com')
    expect(matchDirectoryPerson(xia, '霞')).toBe(true)
    expect(matchDirectoryPerson(xia, 'wangxx')).toBe(true)
    expect(matchDirectoryPerson(xia, 'smjtools')).toBe(false)
    expect(matchDirectoryPerson(xia, 'wangxx@smj')).toBe(true)
    expect(matchDirectoryPerson(xia, '')).toBe(false)
  })

  it('服务端结果在前，本地多出的人补在后面', () => {
    const merged = mergeDirectoryPeople(
      [{ ...person('u2', '赵霞', 'zhaox@smjtools.com'), department: '生产制造部' }],
      [person('u1', '王小霞', 'wangxx@smjtools.com'), person('u2', '赵霞', 'zhaox@smjtools.com')]
    )
    expect(merged.map((item) => item.uid)).toEqual(['u2', 'u1'])
    expect(merged[0].department).toBe('生产制造部')
  })
})
