import type { EntityType } from '../../shared/constants.js';
import { TRANSITION_MAP } from '../../shared/state-transitions.js';

/**
 * State Machine — 순수 함수 (외부 의존 없음)
 *
 * 정의 원본: DES-004 v2.2 §6 · §전체 함수 시그니처 요약
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙 4): "State Machine은 순수 함수".
 * 전이 규칙 자체는 여기 두지 않는다 — `src/shared/state-transitions.ts`의
 * `TRANSITION_MAP`을 조회만 한다(RISK-004 완화 방안, 데이터로 정의).
 */

/** 조회 대상 맵을 느슨한 타입으로 본다 — 엔티티별 상태 리터럴 유니온을 여기서 좁히지 않는다 */
type LooseTransitionTable = Record<string, readonly string[] | undefined>;

function lookupTransitions(entityType: EntityType): LooseTransitionTable {
  return TRANSITION_MAP[entityType] as LooseTransitionTable;
}

/** `fromStatus → toStatus` 전이가 허용되는지 조회한다. 정의되지 않은 상태는 false다 */
export function validateTransition(
  entityType: EntityType,
  fromStatus: string,
  toStatus: string,
): boolean {
  return lookupTransitions(entityType)[fromStatus]?.includes(toStatus) ?? false;
}

/** `fromStatus`에서 허용된 전이 목록을 조회한다. 정의되지 않은 상태는 빈 배열이다 */
export function getAllowedTransitions(entityType: EntityType, fromStatus: string): string[] {
  return [...(lookupTransitions(entityType)[fromStatus] ?? [])];
}
