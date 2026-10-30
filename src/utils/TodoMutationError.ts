export class TodoSavedRefreshError extends Error {
  constructor(cause: unknown) {
    super('操作已保存，但刷新失败；请刷新后查看结果', { cause })
    this.name = 'TodoSavedRefreshError'
  }
}
