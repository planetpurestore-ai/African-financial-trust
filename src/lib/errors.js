export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, details) => new ApiError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Authentication required') => new ApiError(401, 'unauthorized', message);
export const forbidden = (message = 'Not permitted') => new ApiError(403, 'forbidden', message);
export const notFound = (message = 'Not found') => new ApiError(404, 'not_found', message);
export const conflict = (message, details) => new ApiError(409, 'conflict', message, details);
export const unprocessable = (message, details) => new ApiError(422, 'unprocessable', message, details);
export const tooMany = (message = 'Too many requests') => new ApiError(429, 'rate_limited', message);
export const serverError = (message = 'Internal error') => new ApiError(500, 'internal_error', message);

export function errorBody(error, requestId) {
  const status = error instanceof ApiError ? error.status : 500;
  return {
    error: {
      code: error instanceof ApiError ? error.code : 'internal_error',
      message: error instanceof ApiError ? error.message : 'An unexpected error occurred',
      ...(error.details ? { details: error.details } : {}),
      request_id: requestId,
    },
  };
}
