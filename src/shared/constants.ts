/**
 * 시스템 코드 상수
 *
 * 정의 원본: DES-009 v3.1 코드 정의서
 * DB CHECK 제약(DES-003 v2.1)과 값이 일치해야 한다. 하나라도 어긋나면
 * 애플리케이션은 통과시키고 DB가 거부하는 상태가 된다.
 */

// ─────────────────────────────────────────────
// 상태 Enum
// ─────────────────────────────────────────────

export const ProjectStatus = {
  READY: 'ready',
  RUNNING: 'running',
  WAITING: 'waiting',
  PAUSED: 'paused',
  PENDING_COMPLETION: 'pending_completion',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

/** Agent는 작업 완료 시 자동으로 completed 전이한다 — pending_completion이 없다 (DES-007 §10) */
export const AgentStatus = {
  CREATED: 'created',
  RUNNING: 'running',
  WAITING: 'waiting',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const TaskStatus = {
  READY: 'ready',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'in_review',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

/** 6종. DES-003 v2.1 §3-5 status_changes.entity_type CHECK 제약과 동일해야 한다 */
export const EntityType = {
  PROJECT: 'project',
  AGENT: 'agent',
  TASK: 'task',
  CONVERSATION: 'conversation',
  APPROVAL: 'approval',
  STAGE: 'stage',
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

// ─────────────────────────────────────────────
// 대화 Enum (FR-026 · FR-027)
// ─────────────────────────────────────────────

/** DB 저장값은 'MSG-01' 형태의 코드 문자열이다. 의미 이름은 상수명으로만 쓴다 */
export const MessageType = {
  CEO_UTTERANCE: 'MSG-01',
  MAIN_RESPONSE: 'MSG-02',
  AGENT_REPORT: 'MSG-03',
  DECISION_REQUEST: 'MSG-04',
  SYSTEM_EVENT: 'MSG-05',
  ARTIFACT_LINK: 'MSG-06',
} as const;
export type MessageType = (typeof MessageType)[keyof typeof MessageType];

export const ChannelType = {
  MAIN: 'main',
  AGENT: 'agent',
} as const;
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const ConversationStatus = {
  ACTIVE: 'active',
  READONLY: 'readonly',
  ARCHIVED: 'archived',
} as const;
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus];

export const SenderRole = {
  CEO: 'ceo',
  MAIN: 'main',
  AGENT: 'agent',
  SYSTEM: 'system',
} as const;
export type SenderRole = (typeof SenderRole)[keyof typeof SenderRole];

// ─────────────────────────────────────────────
// 승인 Enum (FR-028 · FR-030)
// ─────────────────────────────────────────────

export const ApprovalType = {
  GATE: 'APV-GATE',
  ARCH: 'APV-ARCH',
  DEPLOY: 'APV-DEPLOY',
  EXT: 'APV-EXT',
  CHOICE: 'APV-CHOICE',
  RETRY: 'APV-RETRY',
} as const;
export type ApprovalType = (typeof ApprovalType)[keyof typeof ApprovalType];

/** 5종. 'expired'는 없다 — 만료는 auto_advanced로 귀결된다 (DES-007 v2 §6) */
export const ApprovalStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CONDITIONAL: 'conditional',
  AUTO_ADVANCED: 'auto_advanced',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

/** 판정용 3종. DB(approvals.level)에 적재되는 것은 high·medium 2종뿐이다 */
export const DecisionLevel = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;
export type DecisionLevel = (typeof DecisionLevel)[keyof typeof DecisionLevel];

/** approvals.level 컬럼에 실제로 저장 가능한 값 (DES-003 v2.1 §4-1 CHECK) */
export type StoredDecisionLevel = Exclude<DecisionLevel, 'low'>;

/** D-11 — 신규 상태를 만들지 않고 사유 필드로 세분화했다 */
export const WaitingReason = {
  CEO_APPROVAL: 'ceo_approval',
  CEO_DECISION: 'ceo_decision',
  EXTERNAL_INPUT: 'external_input',
} as const;
export type WaitingReason = (typeof WaitingReason)[keyof typeof WaitingReason];

// ─────────────────────────────────────────────
// 진행 Enum (FR-029 · FR-031)
// ─────────────────────────────────────────────

export const SkillName = {
  PLAN: 'plan',
  ANALYZE: 'analyze',
  DESIGN: 'design',
  DEVELOP: 'develop',
  TEST: 'test',
  DEPLOY: 'deploy',
  OPERATE: 'operate',
} as const;
export type SkillName = (typeof SkillName)[keyof typeof SkillName];

/**
 * CLAUDE.md 스킬 전환 모드에서 승인이 필수인 전환의 **시작 단계** (DES-002 v2.1
 * §5 `GET /api/phases/current` 응답 예시 · DES-007 v2.1 §7-2 근거).
 *
 * **단일 원본이다.** `PhaseService.isGateRequired()`(gate.required 파생)와
 * `StageService.isGateRequired()`(착수 가드 2단)가 둘 다 이 배열 하나만
 * 참조한다 — 두 곳에 복제하면 어느 stage의 `approvals.stage_id`에
 * `APV-GATE`를 채워야 하는지가 갈리고, 승인은 났는데 게이트가 안 열리는
 * 상태가 된다 (Layer 2-8 개발 지시 §2). `src/backend/services/stage-mapper.ts`의
 * `isGateRequired()`가 이 배열을 조회하는 유일한 함수다.
 */
export const GATE_REQUIRED_SKILLS: readonly SkillName[] = [SkillName.PLAN, SkillName.TEST];

export const StageStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
} as const;
export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

/**
 * CLAUDE.md "주요 단계 WIP = 1" 규칙 텍스트 — 저장하지 않고 항상 이 문자열로
 * `wip_waivers.rule`을 비교한다. `PhaseService.checkWip()`과
 * `StageService.start()` 가드 3단이 서로 다른 문자열을 쓰면 같은 면제를
 * 두고도 한쪽만 `waived: true`를 보는 불일치가 생긴다 — 단일 원본으로 둔다.
 */
export const WIP_RULE = '주요 단계 WIP = 1';

export const ArtifactStatus = {
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
} as const;
export type ArtifactStatus = (typeof ArtifactStatus)[keyof typeof ArtifactStatus];

/**
 * 저장하지 않고 notionUrl·gitPath 유무에서 파생한다 (DES-003 v2.1 §4-4).
 * notion_only와 missing의 구분이 이 Enum의 존재 이유다 —
 * 2026-09-01 "analyze 건너뜀" 오진단이 둘을 혼동한 사고였다.
 */
export const SyncStatus = {
  SYNCED: 'synced',
  NOTION_ONLY: 'notion_only',
  GIT_ONLY: 'git_only',
  MISSING: 'missing',
} as const;
export type SyncStatus = (typeof SyncStatus)[keyof typeof SyncStatus];

// ─────────────────────────────────────────────
// 에러 코드
// ─────────────────────────────────────────────

export const ErrorCode = {
  // 공통
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // 도메인 — 기존
  AUTH_INVALID_SECRET: 'AUTH_INVALID_SECRET',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PROJECT_NAME_CONFLICT: 'PROJECT_NAME_CONFLICT',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  AGENT_NAME_CONFLICT: 'AGENT_NAME_CONFLICT',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  PARENT_NOT_ACTIVE: 'PARENT_NOT_ACTIVE',
  DB_CONNECTION_ERROR: 'DB_CONNECTION_ERROR',
  MIGRATION_ERROR: 'MIGRATION_ERROR',

  // 도메인 — 대화·승인·진행 (v3 신규 9종)
  CONVERSATION_NOT_FOUND: 'CONVERSATION_NOT_FOUND',
  CONVERSATION_ARCHIVED: 'CONVERSATION_ARCHIVED',
  APPROVAL_NOT_FOUND: 'APPROVAL_NOT_FOUND',
  APPROVAL_ALREADY_RESOLVED: 'APPROVAL_ALREADY_RESOLVED',
  APPROVAL_REASON_REQUIRED: 'APPROVAL_REASON_REQUIRED',
  GATE_AUTO_ADVANCE_FORBIDDEN: 'GATE_AUTO_ADVANCE_FORBIDDEN',
  GATE_NOT_PASSED: 'GATE_NOT_PASSED',
  WIP_VIOLATION: 'WIP_VIOLATION',
  STAGE_NOT_FOUND: 'STAGE_NOT_FOUND',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 브라우저 WebSocket API는 헤더를 실을 수 없어 인증만 쿼리 파라미터를 쓴다 */
export const WsCloseCode = {
  GOING_AWAY: 1001,
  UNAUTHORIZED: 4001,
  NOT_FOUND: 4004,
} as const;
export type WsCloseCode = (typeof WsCloseCode)[keyof typeof WsCloseCode];

// ─────────────────────────────────────────────
// 서버·인증·CLI 상수 (DES-009 v3.1 §상수)
// ─────────────────────────────────────────────

/** Phase 1은 루프백 전용이다. 터널링(D-19)이 Phase 2로 연기되어 외부 노출이 없다 */
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;
export const SHUTDOWN_TIMEOUT_MS = 10_000;
export const DB_FILE_PATH = './data/claude-manager.db';

export const JWT_EXPIRES_IN = '7d';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const CLI_CONFIG_DIR = '.claude-manager';
export const CLI_CONFIG_FILE = 'config.json';
export const DEFAULT_SERVER_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

/** 등급 '보통' 승인의 타임아웃 (D-10) */
export const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;
/** ApprovalTimeoutJob 실행 주기 (DES-001 ADR-012) */
export const APPROVAL_JOB_INTERVAL_MS = 60 * 1000;
