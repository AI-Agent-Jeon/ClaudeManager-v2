/**
 * 공유 타입 정의
 *
 * 정의 원본: DES-004 v2.2 §공통 타입 정의
 * DES-002 v2.1 §6-1의 JSON Schema는 이 타입들에서 기계적으로 도출한다 —
 * 여기 없는 타입은 Fastify 스키마를 만들 수 없다.
 */

import type {
  AgentStatus,
  ApprovalStatus,
  ApprovalType,
  ArtifactStatus,
  ChannelType,
  ConversationStatus,
  DecisionLevel,
  EntityType,
  MessageType,
  ProjectStatus,
  SenderRole,
  SkillName,
  StageStatus,
  SyncStatus,
  TaskStatus,
  WaitingReason,
} from './constants.js';

// ─────────────────────────────────────────────
// 공통 응답 래퍼
// ─────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
}

/** Service가 Route에 돌려주는 계산된 페이지 정보 */
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: Pagination;
}

export interface PaginationOpts {
  page: number;
  pageSize: number;
}

/**
 * 메시지 전용 커서 페이지네이션.
 * 오프셋 방식은 스크롤 도중 새 메시지가 들어오면 오프셋이 밀려
 * 같은 메시지가 중복 표시된다 (DES-002 v2.1 §2-3).
 */
export interface CursorResponse<T> {
  data: T[];
  cursor: {
    next: string | null;
    hasMore: boolean;
  };
}

/**
 * 에러 응답
 *
 * `details`는 **선택**이다. 평소에는 4필드만 나가고, 클라이언트가 구조적으로
 * 써야 하는 부가 정보가 있을 때만 붙는다.
 *
 * 왜 필요한가: DES-006 SCR-P04가 불허 전이 시 CLI에 "허용 목록 출력"을
 * 요구하는데, 그 목록을 한국어 메시지 문장에서 파싱하게 두면 문구를 다듬는
 * 순간 깨진다. 4필드 고정(DES-009)과 `allowedTransitions` 전달(DES-004 §6)이
 * 충돌해 대표 결정으로 선택 필드를 추가했다 (2026-09-02).
 */
export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  code: string;
  details?: Record<string, unknown>;
}

// ─────────────────────────────────────────────
// 헬스 · 인증 (FR-001 · FR-002)
// ─────────────────────────────────────────────

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptime: number;
  database: 'connected' | 'disconnected';
}

export interface LoginRequest {
  secret: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
}

// ─────────────────────────────────────────────
// 프로젝트 (FR-003 ~ FR-006)
// ─────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends Project {
  agents: Agent[];
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface ListProjectsOpts {
  page?: number;
  pageSize?: number;
  status?: ProjectStatus;
}

// ─────────────────────────────────────────────
// Agent (FR-007)
// ─────────────────────────────────────────────

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  type: string;
  status: AgentStatus;
  skill: string;
  config: Record<string, unknown>;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/agents/:id 응답. ProjectDetail이 agents를 안는 것과 같은 구조 */
export interface AgentDetail extends Agent {
  tasks: Task[];
  /** status === 'waiting'일 때만 (D-11) */
  waitingReason: WaitingReason | null;
  /** 이 Agent의 CH-AGENT (D-27) */
  conversationId: string | null;
}

export interface CreateAgentInput {
  projectId: string;
  name: string;
  type?: string;
  skill?: string;
  config?: Record<string, unknown>;
}

export interface ListAgentsOpts {
  page?: number;
  pageSize?: number;
  projectId?: string;
  status?: AgentStatus;
}

/** DELETE /api/agents/:id 응답 — 대화 보존(D-27) + 승인 마감(R-04) */
export interface DeleteAgentResult {
  archivedConversationId: string | null;
  closedApprovalCount: number;
}

// ─────────────────────────────────────────────
// Task (FR-008)
// ─────────────────────────────────────────────

export interface Task {
  id: string;
  agentId: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  agentId: string;
  title: string;
  description?: string;
}

export interface ListTasksOpts {
  page?: number;
  pageSize?: number;
  agentId?: string;
  status?: TaskStatus;
}

// ─────────────────────────────────────────────
// 상태 변경 이력 (FR-009)
// ─────────────────────────────────────────────

export interface StatusChange {
  id: number;
  entityType: EntityType;
  entityId: string;
  /** 최초 생성 시 null — '' 가 아니다 (DES-003 v2.1 §3-5) */
  fromStatus: string | null;
  toStatus: string;
  changedBy: string;
  changedAt: string;
}

export interface ListStatusChangesOpts {
  page?: number;
  pageSize?: number;
  entityType?: EntityType;
  entityId?: string;
}

// ─────────────────────────────────────────────
// 대화 (FR-026 · FR-027)
// ─────────────────────────────────────────────

/**
 * 삭제된 Agent의 정보 보존용 (D-27)
 *
 * `projectId`는 화면 표시용이 아니라 **필터링용**이다. Agent가 삭제되면
 * `agents` 조인이 비어 `GET /api/conversations?project=`가 그 채널을
 * 떨어뜨린다. 이름만으로는 매칭할 수 없어 id를 함께 남긴다.
 */
export interface EntitySnapshot {
  agentName: string;
  projectName: string;
  projectId: string;
  agentType: string;
}

export interface Conversation {
  id: string;
  channelType: ChannelType;
  /** agents.id — FK가 아니다 (D-27) */
  entityId: string | null;
  status: ConversationStatus;
  entitySnapshot: EntitySnapshot | null;
  /** 파생: entitySnapshot ?? agents 조인 */
  title: string;
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  archivedAt: string | null;
}

/** MSG-03 전용 — CLAUDE.md 보고 형식 4단을 그대로 구조화 */
export interface StructuredReport {
  summary: string;
  workDone: string;
  artifacts: string[];
  openIssues: string;
}

export interface Message {
  id: string;
  conversationId: string;
  msgType: MessageType;
  senderRole: SenderRole;
  body: string;
  /** msgType === 'MSG-03'일 때만 */
  structured: StructuredReport | null;
  /** msgType === 'MSG-04'일 때만 */
  approvalId: string | null;
  createdAt: string;
}

/** msgType·senderRole은 서버가 고정한다. 클라이언트가 지정할 수 없다 */
export interface SendMessageInput {
  body: string;
}

export interface ListConversationsOpts {
  type?: ChannelType;
  status?: ConversationStatus;
  project?: string;
  from?: string;
  to?: string;
}

export interface ListMessagesOpts {
  cursor?: string;
  limit?: number;
  direction?: 'before' | 'after';
}

export interface SearchMessagesOpts {
  q: string;
  type?: ChannelType;
  status?: ConversationStatus;
  from?: string;
  to?: string;
  limit?: number;
}

export interface SearchResult {
  messageId: string;
  conversationId: string;
  conversationTitle: string;
  /** FTS5 snippet() — <mark> 포함 */
  snippet: string;
  createdAt: string;
}

// ─────────────────────────────────────────────
// 승인 (FR-028 · FR-030)
// ─────────────────────────────────────────────

export interface ApprovalOption {
  code: string;
  label: string;
  recommended?: boolean;
}

export interface ApprovalImpact {
  documents: string[];
  reversible: boolean;
}

export interface ApprovalSummary {
  id: string;
  approvalType: ApprovalType;
  level: DecisionLevel;
  subject: string;
  requestedBy: string;
  status: ApprovalStatus;
  /** high는 항상 null (무기한) */
  deadlineAt: string | null;
  /** 파생 — 승인함 "경과 시간" */
  elapsedSeconds: number;
  /** 파생 — 승인함 "기한" */
  remainingSeconds: number | null;
  createdAt: string;
}

export interface ApprovalDetail extends ApprovalSummary {
  options: ApprovalOption[];
  artifacts: ArtifactRef[];
  rationale: string | null;
  impact: ApprovalImpact | null;
  messageId: string | null;
  stageId: string | null;
  resolution: string | null;
  reason: string | null;
  resolvedAt: string | null;
}

/** 'auto_advanced'와 'pending'은 없다 — 타임아웃 자동 진행은 스케줄러 전용 */
export interface ResolveApprovalInput {
  status: 'approved' | 'rejected' | 'conditional';
  resolution?: string | null;
  /** rejected·conditional이면 필수 (안전장치 S-2) */
  reason?: string | null;
}

export interface ListApprovalsOpts {
  status?: ApprovalStatus;
  level?: DecisionLevel;
  type?: ApprovalType;
  sort?: 'deadline' | 'created';
}

/** POST /api/approvals — 승인 건 직접 상정 (R-07) */
export interface CreateApprovalInput {
  approvalType: ApprovalType;
  level: DecisionLevel;
  subject: string;
  options: ApprovalOption[];
  artifacts?: string[];
  rationale?: string;
  impact?: ApprovalImpact;
  requestedBy: string;
  stageId?: string;
  conversationId: string;
}

// ─────────────────────────────────────────────
// 진행 (FR-029 · FR-031)
// ─────────────────────────────────────────────

/** syncStatus는 저장하지 않고 notionUrl·gitPath 유무에서 파생한다 */
export interface ArtifactRef {
  code: string;
  title: string;
  notionUrl: string | null;
  gitPath: string | null;
  syncStatus: SyncStatus;
}

export interface Artifact extends ArtifactRef {
  id: string;
  stageId: string;
  status: ArtifactStatus;
  updatedAt: string;
}

export interface GateInfo {
  /** 파생 — CLAUDE.md 스킬 전환 모드 */
  required: boolean;
  approvalId: string | null;
  passed: boolean;
}

export interface StageSummary {
  id: string;
  skill: SkillName;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  artifactCount: number;
  pendingApprovalCount: number;
  gate: GateInfo;
}

export interface WipViolation {
  rule: string;
  detail: string;
  waived: boolean;
}

export interface PhaseCurrent {
  phase: {
    id: string;
    number: number;
    name: string;
    currentStage: SkillName | null;
  };
  /** 항상 7개 */
  stages: StageSummary[];
  /** 저장하지 않고 조회 시점 계산 */
  wipViolations: WipViolation[];
}

/** POST /api/phases — Phase + 7단계 동시 생성 (R-01) */
export interface CreatePhaseInput {
  number: number;
  name: string;
}

export interface CreateWipWaiverInput {
  phaseId: string;
  rule: string;
  /** 필수. 빈 문자열 불가 */
  reason: string;
}

// ─────────────────────────────────────────────
// 산출물 (FR-031)
// ─────────────────────────────────────────────

/** GET /api/artifacts — syncStatus는 저장 값이 아니라 파생값 기준으로 필터링한다 */
export interface ListArtifactsOpts {
  stage?: string;
  syncStatus?: SyncStatus;
}

/** ArtifactService.upsert() 입력 — DES-004 §전체 함수 시그니처 요약 */
export interface UpsertArtifactInput {
  stageId: string;
  code: string;
  title: string;
  notionUrl?: string;
  gitPath?: string;
}

// ─────────────────────────────────────────────
// WebSocket 이벤트 (NFR-003)
// ─────────────────────────────────────────────

export interface WsEnvelope<T> {
  event: string;
  data: T;
}

/** WS /ws/conversations/:id — approval:created는 보내지 않는다 (MSG-04의 message:new와 중복) */
export type ConversationEvent =
  | WsEnvelope<Message>
  | WsEnvelope<{ senderRole: SenderRole }>
  | WsEnvelope<ApprovalSummary>;

/** WS /ws */
export type GlobalEvent =
  | WsEnvelope<StatusChange>
  | WsEnvelope<ApprovalSummary>
  | WsEnvelope<StageSummary>;
