import { describe, expect, it, vi } from 'vitest'
import { createHistoryPager, displayDate, fileQuery, toFileResponse } from './history'

const message = (id: string, type: number, body: Record<string, unknown>, sendTime: number, uid = 'u2') => ({
  fromUser: { uid, username: uid === 'u2' ? '时丽燕' : '李尚松', avatar: `/a/${uid}` },
  message: { id, roomId: '9', type, body, sendTime }
})

describe('聊天记录窗口', () => {
  it('页码换成游标，条件变了从头开始', async () => {
    const fetchPage = vi.fn(async (query: Record<string, unknown>) => ({
      list: [{ message: { id: String(query.cursor ?? 'first') } }],
      cursor: query.cursor ? 'c2' : 'c1',
      isLast: Boolean(query.cursor)
    }))
    const pager = createHistoryPager(fetchPage)
    const param = { roomId: '9', messageType: 'file', searchKeyword: ' 预算 ', pagination: { page: 1, pageSize: 50 } }
    expect(await pager(param)).toEqual({ messages: [{ message: { id: 'first' } }], hasMore: true, currentPage: 1 })
    expect(fetchPage).toHaveBeenLastCalledWith({
      roomId: '9',
      kind: 'file',
      keyword: '预算',
      startTime: undefined,
      endTime: undefined,
      pageSize: 50,
      cursor: undefined
    })
    expect((await pager({ ...param, pagination: { page: 2, pageSize: 50 } })).hasMore).toBe(false)
    expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }))
    // 换了关键词还停在第 2 页：没有对应游标，不去请求
    expect(await pager({ ...param, searchKeyword: '会议', pagination: { page: 2, pageSize: 50 } })).toEqual({
      messages: [],
      hasMore: false,
      currentPage: 2
    })
  })
})

describe('文件窗口', () => {
  it('按导航类型选房间或发送人', () => {
    expect(fileQuery({ navigationType: 'myFiles', roomId: '9', selectedUser: 'u2' })).toMatchObject({
      roomId: undefined,
      fromUid: undefined
    })
    expect(fileQuery({ navigationType: 'groups', roomId: '9' })).toMatchObject({ kind: 'files', roomId: '9' })
    expect(fileQuery({ navigationType: 'senders', selectedUser: 'u2' })).toMatchObject({ fromUid: 'u2' })
  })

  it('按天分组、新的在前，并列出发送人', () => {
    const now = new Date(2026, 9, 20, 18)
    const today = new Date(2026, 9, 20, 9, 5, 7).getTime()
    const yesterday = new Date(2026, 9, 19, 9).getTime()
    const response = toFileResponse(
      {
        list: [
          message('1', 4, { fileName: '预算.xlsx', size: 10, url: 'https://x/a' }, yesterday),
          message('2', 6, { url: 'https://x/files/abc/%E4%BC%9A%E8%AE%AE.mp4', size: 20 }, today, 'u1'),
          message('3', 1, { content: '文字' }, today)
        ],
        cursor: '1',
        isLast: true
      },
      now
    )
    expect(
      response.timeGroupedFiles.map((group) => [group.displayDate, group.files.map((file) => file.fileName)])
    ).toEqual([
      ['今天', ['会议.mp4']],
      ['昨天', ['预算.xlsx']]
    ])
    expect(response.timeGroupedFiles[0].files[0]).toMatchObject({
      fileType: 'video',
      fileSize: 20,
      uploadTime: '2026-10-20 09:05:07'
    })
    expect(response.userList.map((user) => user.name)).toEqual(['李尚松', '时丽燕'])
    expect(response.hasMore).toBe(false)
  })

  it('日期显示与桌面版一致', () => {
    const now = new Date(2026, 9, 20)
    expect(displayDate(new Date(2026, 2, 3), now)).toBe('03月03日')
    expect(displayDate(new Date(2025, 11, 31), now)).toBe('2025年12月31日')
  })
})
