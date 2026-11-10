/**
 * 统一的 API 错误类型。抛出后由 app.js 的错误中间件转成 JSON 响应。
 */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) =>
  new ApiError(400, 'BAD_REQUEST', message, details);

export const notFound = (message) => new ApiError(404, 'NOT_FOUND', message);

export const internal = (message) => new ApiError(500, 'INTERNAL_ERROR', message);
