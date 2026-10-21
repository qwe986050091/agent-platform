/** 统一 API 错误：status 为 0 表示网络/中断类错误，200 表示 SSE 已提交后的业务错误 */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
