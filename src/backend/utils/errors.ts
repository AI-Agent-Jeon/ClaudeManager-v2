import { ErrorCode } from '../../shared/constants.js';
import type { ErrorResponse } from '../../shared/types.js';

/**
 * 에러 표현
 *
 * 정의 원본: DES-009 v3.1 §HTTP 에러 응답 형식 (4필드 고정)
 */

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

/**
 * 어떤 에러든 4필드 응답으로 바꾼다.
 *
 * **내부 오류의 원문을 노출하지 않는다** (PR 자체 검토 §보안).
 * SQLite 에러 메시지에는 파일 경로가 섞여 있다.
 */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      error: STATUS_TEXT[err.statusCode] ?? 'Error',
      message: err.message,
      code: err.code,
    };
  }

  return {
    statusCode: 500,
    error: STATUS_TEXT[500] as string,
    message: '서버 내부 오류가 발생했습니다',
    code: ErrorCode.INTERNAL_ERROR,
  };
}
