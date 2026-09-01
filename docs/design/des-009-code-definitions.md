# DES-009 코드 정의서

> Phase 1: 기반 구축
> 버전: v2.0 (2026-08-24)
> **원본**: [Notion DES-009](https://app.notion.com/p/3c5d066504ec814488cbfec3661f0667) · Git 동기화 2026-09-01
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

---

## 상태 코드

### ProjectStatus

| 코드 | 값 | 설명 | DB 저장값 |
|------|-----|------|----------|
| READY | `"ready"` | 생성됨, 실행 대기 | ready |
| RUNNING | `"running"` | 실행 중 | running |
| WAITING | `"waiting"` | 외부 입력/승인 대기 | waiting |
| PAUSED | `"paused"` | 사용자가 일시정지 | paused |
| PENDING_COMPLETION | `"pending_completion"` | 완료 승인 대기 | pending_completion |
| COMPLETED | `"completed"` | 정상 완료 | completed |
| FAILED | `"failed"` | 오류로 실패 | failed |
| CANCELLED | `"cancelled"` | 사용자가 취소 | cancelled |

### AgentStatus

| 코드 | 값 | 설명 | DB 저장값 |
|------|-----|------|----------|
| CREATED | `"created"` | 생성됨, 실행 대기 | created |
| RUNNING | `"running"` | 작업 수행 중 | running |
| WAITING | `"waiting"` | 의사결정/입력 대기 | waiting |
| PAUSED | `"paused"` | 사용자가 일시정지 | paused |
| COMPLETED | `"completed"` | 정상 완료 | completed |
| FAILED | `"failed"` | 오류로 실패 | failed |
| CANCELLED | `"cancelled"` | 사용자가 취소 | cancelled |

### TaskStatus

| 코드 | 값 | 설명 | DB 저장값 |
|------|-----|------|----------|
| READY | `"ready"` | 생성됨, 실행 대기 | ready |
| IN_PROGRESS | `"in_progress"` | 작업 수행 중 | in_progress |
| IN_REVIEW | `"in_review"` | 결과 검토 중 | in_review |
| PAUSED | `"paused"` | 사용자가 일시정지 | paused |
| COMPLETED | `"completed"` | 정상 완료 | completed |
| FAILED | `"failed"` | 오류로 실패 | failed |
| CANCELLED | `"cancelled"` | 사용자가 취소 | cancelled |
| SKIPPED | `"skipped"` | 실행 불필요로 건너뜀 | skipped |

### EntityType (상태 변경 이력용)

| 코드 | 값 | 설명 |
|------|-----|------|
| PROJECT | `"project"` | 프로젝트 |
| AGENT | `"agent"` | 에이전트 |
| TASK | `"task"` | 태스크 |

---

## 에러 코드

### HTTP 에러 응답 형식

```typescript
interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string;
  code: string;
}
```

### 공통 에러 코드

| 코드 | HTTP | 설명 | 발생 조건 |
|------|:---:|------|----------|
| VALIDATION_ERROR | 400 | 요청 데이터 유효성 검증 실패 | JSON Schema 검증 실패 |
| UNAUTHORIZED | 401 | 인증 실패 | 토큰 없음/만료/무효 |
| FORBIDDEN | 403 | 권한 없음 | 접근 불허 리소스 |
| NOT_FOUND | 404 | 리소스 없음 | 존재하지 않는 ID |
| INTERNAL_ERROR | 500 | 서버 내부 오류 | 예기치 않은 오류 |

### 도메인별 에러 코드

| 코드 | HTTP | 설명 | 발생 조건 |
|------|:---:|------|----------|
| AUTH_INVALID_SECRET | 401 | 인증 시크릿 불일치 | 로그인 시 잘못된 시크릿 |
| AUTH_TOKEN_EXPIRED | 401 | 토큰 만료 | JWT 만료 시간 초과 |
| PROJECT_NOT_FOUND | 404 | 프로젝트 없음 | 존재하지 않는 프로젝트 ID |
| PROJECT_NAME_CONFLICT | 409 | 프로젝트 이름 중복 | 동일 이름으로 생성 시도 |
| AGENT_NOT_FOUND | 404 | Agent 없음 | 존재하지 않는 Agent ID |
| AGENT_NAME_CONFLICT | 409 | Agent 이름 중복 | 동일 프로젝트 내 같은 이름 |
| TASK_NOT_FOUND | 404 | Task 없음 | 존재하지 않는 Task ID |
| INVALID_TRANSITION | 422 | 불가능한 상태 전이 | 허용되지 않은 상태 변경 요청 |
| PARENT_NOT_ACTIVE | 422 | 상위 엔티티 비활성 | Agent 시작 시 프로젝트 비활성 |
| DB_CONNECTION_ERROR | 500 | DB 연결 실패 | SQLite 파일 접근 불가 |
| MIGRATION_ERROR | 500 | 마이그레이션 실패 | 스키마 적용 오류 |

---

## API 응답 코드

| HTTP | 용도 |
|:---:|------|
| 200 | 조회 성공, 수정 성공 |
| 201 | 생성 성공 |
| 204 | 삭제 성공 (응답 본문 없음) |

---

## 상수

### 서버 설정

| 상수 | 기본값 | 환경 변수 | 설명 |
|------|--------|----------|------|
| DEFAULT_PORT | 3000 | CM_PORT | 서버 포트 |
| DEFAULT_HOST | `"127.0.0.1"` | CM_HOST | 서버 호스트 (localhost only) |
| SHUTDOWN_TIMEOUT_MS | 10000 | — | Graceful shutdown 타임아웃 |
| DB_FILE_PATH | `"./data/claude-manager.db"` | CM_DB_PATH | SQLite 파일 경로 |

> **⚠ D-19 승인 반영 필요**: `DEFAULT_HOST`의 "localhost only" 전제가 터널링 도입으로 바뀐다. 터널 바인딩 방식에 따라 값 또는 주석 갱신 필요.

### 인증

| 상수 | 기본값 | 환경 변수 | 설명 |
|------|--------|----------|------|
| JWT_EXPIRES_IN | `"7d"` | CM_JWT_EXPIRES | JWT 만료 시간 |
| AUTH_SECRET | (랜덤 생성) | CM_AUTH_SECRET | JWT 서명 시크릿 |

### 페이지네이션

| 상수 | 기본값 | 설명 |
|------|--------|------|
| DEFAULT_PAGE_SIZE | 20 | 기본 페이지 크기 |
| MAX_PAGE_SIZE | 100 | 최대 페이지 크기 |

### CLI

| 상수 | 기본값 | 설명 |
|------|--------|------|
| CLI_CONFIG_DIR | `~/.claude-manager` | CLI 설정 디렉토리 |
| CLI_CONFIG_FILE | `config.json` | CLI 설정 파일명 |
| DEFAULT_SERVER_URL | `http://127.0.0.1:3000` | 기본 서버 URL |

---

## TypeScript 타입 정의 (src/shared/)

```typescript
// --- 상태 Enum ---

export const ProjectStatus = {
  READY: "ready",
  RUNNING: "running",
  WAITING: "waiting",
  PAUSED: "paused",
  PENDING_COMPLETION: "pending_completion",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

export const AgentStatus = {
  CREATED: "created",
  RUNNING: "running",
  WAITING: "waiting",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];

export const TaskStatus = {
  READY: "ready",
  IN_PROGRESS: "in_progress",
  IN_REVIEW: "in_review",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SKIPPED: "skipped",
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const EntityType = {
  PROJECT: "project",
  AGENT: "agent",
  TASK: "task",
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];

// --- 에러 코드 ---

export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  AUTH_INVALID_SECRET: "AUTH_INVALID_SECRET",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  PROJECT_NOT_FOUND: "PROJECT_NOT_FOUND",
  PROJECT_NAME_CONFLICT: "PROJECT_NAME_CONFLICT",
  AGENT_NOT_FOUND: "AGENT_NOT_FOUND",
  AGENT_NAME_CONFLICT: "AGENT_NAME_CONFLICT",
  TASK_NOT_FOUND: "TASK_NOT_FOUND",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  PARENT_NOT_ACTIVE: "PARENT_NOT_ACTIVE",
  DB_CONNECTION_ERROR: "DB_CONNECTION_ERROR",
  MIGRATION_ERROR: "MIGRATION_ERROR",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
```

---

## Agent 유형 (참조용)

Phase 1에서는 에이전트 유형을 자유 텍스트로 입력받는다. 향후 Enum 확장 가능.

| 유형 | 설명 |
|------|------|
| project-agent | 프로젝트 실행 책임자 |
| dev-sub | 코딩 실무 |
| test-sub | 테스트 실행 |
| review-sub | 코드 리뷰 |
| docs-sub | 문서 작성 |

---

## Phase 2+ 확장 고려사항

> Orca ADE 분석 결과 반영 (2026-08-24).

| 기능 | 예상 Enum/코드 추가 | 대상 Phase |
|------|-------------------|:---:|
| 실시간 Agent Board (FR-014) | `LogLevel` Enum (debug, info, warn, error), `AgentEvent` 타입 정의 | 2 |
| 비용/토큰 추적 (FR-016) | `ModelType` Enum (opus, sonnet, haiku), `TokenUsage` 인터페이스, 에러 코드 `BUDGET_EXCEEDED` | 2 |
| 칸반 보드 (FR-017) | `KanbanColumn` 타입 (TaskStatus 매핑), `WipLimit` 설정 타입 | 2 |
| 승인 게이트 (FR-018) | `ApprovalStatus` Enum (pending, approved, rejected, timeout), `ApprovalAction` Enum, `DecisionLevel` Enum (high, medium, low), 에러 코드 `APPROVAL_*` | 2 |
| 워크트리 기반 격리 (FR-013) | `WorktreeStatus` Enum (creating, active, merging, cleaned), 에러 코드 `WORKTREE_*` | 3 |
| 워크플로우 템플릿 (FR-019) | `TemplateStatus` Enum (draft, published, archived), 에러 코드 `TEMPLATE_NOT_FOUND` | 3 |
| 공유 메모리 (FR-020) | `MemoryScope` Enum (session, project, global), `MemoryEntry` 인터페이스 | 3 |
| 세션 관리 (FR-021) | `SessionStatus` Enum, `SessionEventType` Enum (start, tool_use, stop, error) | 3 |
| 모바일 모니터링 PWA (FR-015) | `PushEventType` Enum (approval_required, agent_completed, agent_failed) | 4 |
| 오케스트레이션 DAG (FR-022) | `NodeType` Enum (agent, sub_agent), `EdgeType` Enum (parent, handoff, feedback) | 4 |
| 알림/웹훅 (FR-023) | `NotificationChannel` Enum, `NotificationStatus` Enum, 에러 코드 `NOTIFICATION_*` | 4 |
| 롤백/체크포인트 (FR-024) | `CheckpointType` Enum (auto, manual), `RestoreStatus` Enum | 5 |
| 성과 분석 (FR-025) | `MetricType` Enum (success_rate, avg_duration, token_efficiency, retry_count) | 5 |

---

## ⚠ 2026-09-01 승인 반영 필요

승인된 결정에 따라 아래 Enum·코드가 **Phase 1~2로 앞당겨** 필요하다.

| 신규 Enum / 코드 | 값 | 근거 |
|-----------------|-----|------|
| `MessageType` | MSG-01~06 (ceo, main, agent_report, decision_request, system_event, artifact_link) | D-09 · DES-013 §3-1 |
| `ChannelType` | main, agent | D-09 · DES-013 §2 |
| `ConversationStatus` | active, readonly, **archived** | D-27 · DES-013 §2 |
| `ApprovalType` | APV-GATE, APV-ARCH, APV-DEPLOY, APV-EXT, APV-CHOICE, APV-RETRY | D-14 · DES-014 §3-1 |
| `ApprovalStatus` | pending, approved, rejected, conditional, auto_advanced, expired | D-14 · DES-014 §3-3 |
| `DecisionLevel` | high, medium, low | D-10 · DES-013 §3-4 |
| `SkillStage` | plan, analyze, design, develop, test, deploy, operate | D-16 · DES-014 §4 |
| `NotificationType` | NTF-01~07 | D-21 · DES-015 §5-1 |
| `AgentStatus.waiting` **사유 필드** | `waiting_reason`: ceo_approval / external_input | D-11 · DES-007 |
| 에러 코드 추가 | `APPROVAL_NOT_FOUND`, `APPROVAL_ALREADY_RESOLVED`, `GATE_NOT_PASSED`, `WIP_VIOLATION`, `CONVERSATION_ARCHIVED`, `PUSH_SUBSCRIPTION_INVALID` | 전반 |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 (Phase 1 설계) |
| v1.1 | 2026-08-24 | Phase 2+ 확장 고려사항 추가 (FR-013~015) |
| v2.0 | 2026-08-24 | Phase 2~5 전체 Enum/타입 정의 확장 (FR-016~025) |
| — | 2026-09-01 | **Git 동기화** + 승인 반영 필요 Enum·에러코드 정리 |
