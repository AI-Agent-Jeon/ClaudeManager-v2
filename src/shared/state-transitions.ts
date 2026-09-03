/**
 * 상태 전이 규칙 — 데이터로 정의한다
 *
 * 정의 원본: DES-007 v2.1 상태 흐름도 (상태 머신 6종)
 * 전이 규칙을 코드가 아닌 데이터로 두는 것이 RISK-004(상태 전이 복잡성)의
 * 완화 방안이다. State Machine은 이 맵을 조회하는 순수 함수여야 한다.
 */

import type {
  AgentStatus,
  ApprovalStatus,
  ConversationStatus,
  EntityType,
  ProjectStatus,
  StageStatus,
  TaskStatus,
} from './constants.js';

/** 상태 → 허용 전이 목록 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/** DES-007 §2 — 8개 상태 */
export const PROJECT_TRANSITIONS: TransitionTable<ProjectStatus> = {
  ready: ['running', 'cancelled'],
  running: ['waiting', 'paused', 'pending_completion', 'failed', 'cancelled'],
  waiting: ['running', 'cancelled'],
  paused: ['running', 'cancelled'],
  pending_completion: ['completed', 'running'],
  failed: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** DES-007 §3 — 7개 상태. Project와 달리 pending_completion이 없다 */
export const AGENT_TRANSITIONS: TransitionTable<AgentStatus> = {
  created: ['running', 'cancelled'],
  running: ['waiting', 'paused', 'completed', 'failed', 'cancelled'],
  waiting: ['running', 'cancelled'],
  paused: ['running', 'cancelled'],
  failed: ['running', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** DES-007 §4 — 8개 상태. in_review를 거쳐야 completed가 된다 */
export const TASK_TRANSITIONS: TransitionTable<TaskStatus> = {
  ready: ['in_progress', 'skipped', 'cancelled'],
  in_progress: ['in_review', 'paused', 'failed', 'cancelled'],
  in_review: ['completed', 'in_progress', 'failed'],
  paused: ['in_progress', 'cancelled'],
  failed: ['in_progress', 'cancelled'],
  completed: [],
  cancelled: [],
  skipped: [],
};

/**
 * DES-007 §5 — 대화 채널 (D-27)
 * archived에서 되돌아가는 전이는 없다. Agent 행이 이미 삭제되었으므로
 * 되살릴 대상이 없다.
 */
export const CONVERSATION_TRANSITIONS: TransitionTable<ConversationStatus> = {
  active: ['readonly', 'archived'],
  readonly: ['archived'],
  archived: [],
};

/**
 * DES-007 §6 — 승인 (D-16 · D-18)
 * conditional은 종료 상태다. 조건 충족 확인은 새 승인 사이클이지
 * 같은 건의 재전이가 아니다 (R-05).
 */
export const APPROVAL_TRANSITIONS: TransitionTable<ApprovalStatus> = {
  pending: ['approved', 'rejected', 'conditional', 'auto_advanced'],
  approved: [],
  rejected: [],
  conditional: [],
  auto_advanced: [],
};

/**
 * DES-007 §7 — 단계 (FR-030)
 * 선형 3상태다. v2의 `in_progress → pending`(게이트 반려 복귀)은
 * **도달 불가능한 전이**였다 — 게이트를 통과 못하면 애초에 in_progress가
 * 되지 못하므로 그 상황이 성립하지 않는다 (R-03).
 */
export const STAGE_TRANSITIONS: TransitionTable<StageStatus> = {
  pending: ['in_progress'],
  in_progress: ['completed'],
  completed: [],
};

/** 엔티티 유형으로 전이 맵을 조회한다 — State Machine의 입력 */
export const TRANSITION_MAP = {
  project: PROJECT_TRANSITIONS,
  agent: AGENT_TRANSITIONS,
  task: TASK_TRANSITIONS,
  conversation: CONVERSATION_TRANSITIONS,
  approval: APPROVAL_TRANSITIONS,
  stage: STAGE_TRANSITIONS,
} as const satisfies Record<EntityType, TransitionTable<string>>;
