import { GATE_REQUIRED_SKILLS, SkillName } from '../../shared/constants.js';
import type { GateInfo, StageSummary } from '../../shared/types.js';
import type { StageAggregateRow } from '../repositories/phase.repository.js';

/**
 * Stage 매핑 — PhaseService·StageService 공유 (Layer 2-8 개발 지시 §2)
 *
 * `gate.required` 파생 로직·`StageAggregateRow → StageSummary` 변환은 원래
 * `phase.service.ts`에만 있었다. `POST /api/stages/:id/start`의 게이트
 * 가드(2단)가 **같은 판정**을 써야 하므로(어긋나면 승인은 났는데 게이트가
 * 안 열리는 상태가 된다), 이 판정·변환 로직을 단일 모듈로 승격했다.
 * `GATE_REQUIRED_SKILLS` 자체의 단일 원본은 `shared/constants.ts`이고,
 * 이 파일은 그 배열을 조회하는 **유일한 함수**를 제공한다.
 */

/** Phase당 정확히 7단계, CLAUDE.md SDLC 순서 그대로 (plan→analyze→…→operate) */
export const STAGE_ORDER: readonly SkillName[] = Object.values(SkillName);

/**
 * gate.required 파생 — 단일 원본은 `shared/constants.ts`의 `GATE_REQUIRED_SKILLS`.
 * `PhaseService.isGateRequired()`·`StageService.isGateRequired()` 둘 다 이
 * 함수를 통해서만 판정한다. 직접 `GATE_REQUIRED_SKILLS`를 복제해 배열을
 * 두 번째로 두지 않는다 — 그것이 이 계층의 실패 조건이다.
 */
export function isGateRequired(skill: string): boolean {
  return (GATE_REQUIRED_SKILLS as readonly string[]).includes(skill);
}

function toGateInfo(
  row: Pick<StageAggregateRow, 'skill' | 'gate_approval_id' | 'gate_status'>,
): GateInfo {
  return {
    required: isGateRequired(row.skill),
    approvalId: row.gate_approval_id,
    passed: row.gate_status === 'approved',
  };
}

/** `StageAggregateRow`(DB 집계 행) → `StageSummary`(API 응답 형태) */
export function toStageSummary(row: StageAggregateRow): StageSummary {
  return {
    id: row.id,
    skill: row.skill as SkillName,
    status: row.status as StageSummary['status'],
    startedAt: row.started_at,
    completedAt: row.completed_at,
    artifactCount: row.artifact_count,
    pendingApprovalCount: row.pending_approval_count,
    gate: toGateInfo(row),
  };
}

/** STAGE_ORDER(CLAUDE.md SDLC 순서)로 정렬한다 — 7행뿐이라 SQL보다 TS 배열 정렬이 명확하다 */
export function sortBySkillOrder<T extends { skill: string }>(rows: readonly T[]): T[] {
  const order = new Map(STAGE_ORDER.map((skill, idx) => [skill, idx]));
  return [...rows].sort(
    (a, b) => (order.get(a.skill as SkillName) ?? 0) - (order.get(b.skill as SkillName) ?? 0),
  );
}
