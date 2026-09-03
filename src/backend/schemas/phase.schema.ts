/**
 * Phase JSON Schema (FR-029)
 *
 * 정의 원본: DES-002 v2.1 §5(POST /api/phases · POST /api/wip-waivers)
 *
 * 도출 규칙(§6-1): `src/shared/types.ts`의 `CreatePhaseInput`·
 * `CreateWipWaiverInput`에서 기계적으로 변환한다.
 */

/**
 * POST /api/phases — Phase + 7단계 동시 생성 (v2.1 신규 · R-01)
 *
 * `number`는 정수 최소 1 — 스키마가 `number < 1`을 400으로 조기에 걸러낸다.
 * 중복(`number` 유니크 위반)은 스키마로 걸러지지 않으므로 Service가 409로 던진다.
 */
export const createPhaseBodySchema = {
  type: 'object',
  required: ['number', 'name'],
  additionalProperties: false,
  properties: {
    number: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1 },
  },
} as const;

/**
 * POST /api/wip-waivers — WIP 위반 무시 등록
 *
 * `reason`은 `minLength: 1`로 빈 문자열만 조기 차단한다. 공백만 있는
 * 문자열(`"   "`)은 minLength를 통과하므로 Service가 `trim()` 후 재검증한다
 * (개발 지시 §2 — "빈 문자열·공백만도 거부").
 */
export const createWipWaiverBodySchema = {
  type: 'object',
  required: ['phaseId', 'rule', 'reason'],
  additionalProperties: false,
  properties: {
    phaseId: { type: 'string', format: 'uuid' },
    rule: { type: 'string', minLength: 1 },
    reason: { type: 'string', minLength: 1 },
  },
} as const;
