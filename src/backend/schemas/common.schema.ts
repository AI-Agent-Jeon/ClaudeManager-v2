/**
 * 공통 JSON Schema
 *
 * 정의 원본: DES-002 v2.1 §6-2
 *
 * 도출 규칙(§6-1): DES-004 v2.2 타입에서 기계적으로 변환한다.
 * 타입을 두 곳에 손으로 유지하지 않는다.
 */
export const commonSchemas = {
  // biome-ignore lint/style/useNamingConvention: $id는 JSON Schema 예약 키워드다
  $id: 'common',
  definitions: {
    uuid: { type: 'string', format: 'uuid' },
    timestamp: { type: 'string', format: 'date-time' },
    error: {
      type: 'object',
      required: ['statusCode', 'error', 'message', 'code'],
      properties: {
        statusCode: { type: 'integer' },
        error: { type: 'string' },
        message: { type: 'string' },
        code: { type: 'string' },
      },
    },
    pagination: {
      type: 'object',
      required: ['page', 'pageSize', 'total', 'totalPages'],
      properties: {
        page: { type: 'integer' },
        pageSize: { type: 'integer' },
        total: { type: 'integer' },
        totalPages: { type: 'integer' },
      },
    },
    cursor: {
      type: 'object',
      properties: {
        next: { type: ['string', 'null'] },
        hasMore: { type: 'boolean' },
      },
    },
  },
} as const;

/** 목록 조회 공통 쿼리 — 오프셋 페이지네이션 */
export const paginationQuery = {
  page: { type: 'integer', minimum: 1, default: 1 },
  pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
} as const;
