/**
 * 산출물 JSON Schema (FR-031)
 *
 * 정의 원본: DES-004 §전체 함수 시그니처 요약(ArtifactService.upsert) ·
 * D-3(테스트 스킬 9단계 수정 루프 2차, 대표 승인) — `POST /api/artifacts` 신설
 *
 * 도출 규칙(approval.schema.ts와 동일): `src/shared/types.ts`의
 * `UpsertArtifactInput`에서 기계적으로 변환한다.
 *
 * `status`·`syncStatus`는 프로퍼티 자체가 없다 — `additionalProperties: false`가
 * 클라이언트의 직접 지정을 차단한다. `status`는 승인 흐름이 별도로 관리하는
 * 값이라 upsert가 되돌리지 않아야 하고(artifact.repository.ts 상단 주석),
 * `syncStatus`는 저장 컬럼이 아니라 `notionUrl`·`gitPath`에서 파생한다
 * (artifact.service.ts `deriveSyncStatus`).
 */
export const upsertArtifactBodySchema = {
  type: 'object',
  required: ['stageId', 'code', 'title'],
  additionalProperties: false,
  properties: {
    stageId: { type: 'string', format: 'uuid' },
    code: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1 },
    notionUrl: { type: 'string', minLength: 1 },
    gitPath: { type: 'string', minLength: 1 },
  },
} as const;
