import { ApprovalType } from '../../shared/constants.js';

/**
 * 승인 JSON Schema (FR-028 · FR-030)
 *
 * 정의 원본: DES-002 v2.1 §5(POST /api/approvals)·§6-4(resolve 예시)
 *
 * 도출 규칙(§6-1): `src/shared/types.ts`의 `CreateApprovalInput`·
 * `ResolveApprovalInput`에서 기계적으로 변환한다.
 */

const APPROVAL_TYPE_VALUES = Object.values(ApprovalType);

const approvalOptionSchema = {
  type: 'object',
  required: ['code', 'label'],
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 1 },
    label: { type: 'string', minLength: 1 },
    recommended: { type: 'boolean' },
  },
} as const;

const approvalImpactSchema = {
  type: 'object',
  required: ['documents', 'reversible'],
  additionalProperties: false,
  properties: {
    documents: { type: 'array', items: { type: 'string' } },
    reversible: { type: 'boolean' },
  },
} as const;

/**
 * POST /api/approvals — 승인 건 직접 상정 (R-07)
 *
 * `level`은 `high`·`medium`만 받는다. `low`는 적재하지 않으므로(R-06) HTTP로
 * 직접 상정할 대상이 아니다 — 스키마 enum이 그 자체로 `400 VALIDATION_ERROR`를
 * 만든다. `deadlineAt`은 프로퍼티 자체가 없다 — `additionalProperties: false`가
 * 클라이언트의 기한 지정을 차단한다(서버가 등급에서 파생한다, D-10).
 */
export const createApprovalBodySchema = {
  type: 'object',
  required: ['approvalType', 'level', 'subject', 'options', 'requestedBy', 'conversationId'],
  additionalProperties: false,
  properties: {
    approvalType: { type: 'string', enum: APPROVAL_TYPE_VALUES },
    level: { type: 'string', enum: ['high', 'medium'] },
    subject: { type: 'string', minLength: 1 },
    options: { type: 'array', minItems: 1, items: approvalOptionSchema },
    artifacts: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    impact: approvalImpactSchema,
    requestedBy: { type: 'string', minLength: 1 },
    stageId: { type: 'string', format: 'uuid' },
    conversationId: { type: 'string', format: 'uuid' },
  },
} as const;

/**
 * POST /api/approvals/:id/resolve — DES-002 §6-4
 *
 * `enum`에 `auto_advanced`·`pending`이 없다 — 타임아웃 자동 진행은 스케줄러
 * 전용이라 API로 호출할 수 없다.
 */
export const resolveApprovalBodySchema = {
  type: 'object',
  required: ['status'],
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['approved', 'rejected', 'conditional'] },
    resolution: { type: ['string', 'null'] },
    reason: { type: ['string', 'null'] },
  },
  // 반려·조건부는 사유 필수 (승인 안전장치 S-2). 서비스 레벨에서도 동일하게
  // 검증한다 — 스키마는 대부분의 경로를 400에서 조기에 끝내는 방어선이다.
  allOf: [
    {
      if: { properties: { status: { enum: ['rejected', 'conditional'] } } },
      // biome-ignore lint/suspicious/noThenProperty: JSON Schema의 if/then 예약 키워드다
      then: { required: ['reason'], properties: { reason: { type: 'string', minLength: 1 } } },
    },
  ],
} as const;
