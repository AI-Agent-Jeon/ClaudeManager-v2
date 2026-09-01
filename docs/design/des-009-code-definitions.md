# DES-009 코드 정의서

> Phase 1: 기반 구축
> 버전: **v3.0 (2026-09-01)** — 대화·승인·진행 Enum 12종 + 에러 코드 9종 추가
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
| WAITING | `"waiting"` | 의사결정/입력 대기. **`waiting_reason`으로 사유 구분** (v3 · D-11) | waiting |
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

## 대화·승인·진행 코드 — **v3 신규**

> 정의 원본은 **DES-004 v2 공통 타입**과 **DES-007 v2 상태 머신**이다. 본 문서는 그 값을 코드 상수로 확정한다.

### ⚠ 초안과의 차이 3건 (정정)

2026-09-01 초안에 적혀 있던 값 중 **3건이 확정 설계와 어긋나 정정**한다.

| 항목 | 초안 | **확정** | 근거 |
|------|------|---------|------|
| `ApprovalStatus` | pending, approved, rejected, conditional, auto_advanced, **expired** | **`expired` 제외 (5종)** | 만료는 별도 상태가 아니라 `auto_advanced`로 귀결된다. DES-007 v2 §6 전이 맵에 `expired`가 없다 |
| `DecisionLevel` | high, medium, **low** | **저장은 high·medium (2종)** / 판정용 상수는 low 포함 | `low`는 승인함에 올라오지 않고 `approvals`에 적재되지 않는다. DB CHECK가 2종만 허용한다 (DES-003 v2 §4-1) |
| `waiting_reason` | ceo_approval, external_input (2종) | **ceo_approval, ceo_decision, external_input (3종)** | 무기한 대기(높음)와 30분 타임아웃(보통)을 구분해야 한다. DES-007 v2 §3-1 |

### MessageType

DB 저장값은 **`MSG-01` 형태의 코드 문자열**이다. 의미 이름은 상수명으로만 쓴다.

| 코드 | 값 | 설명 | 발신 |
|------|-----|------|------|
| CEO_UTTERANCE | `"MSG-01"` | 대표 발화 — 지시·의사결정 응답 | 대표 |
| MAIN_RESPONSE | `"MSG-02"` | Main 응답 — 스킬 탐색·제안·위임 결과 | Main |
| AGENT_REPORT | `"MSG-03"` | Agent 보고 — **4단 구조화** (`structured`) | Agent |
| DECISION_REQUEST | `"MSG-04"` | 의사결정 요청 — `approval_id` 연결 | Main·Agent |
| SYSTEM_EVENT | `"MSG-05"` | 시스템 이벤트 — 상태 전이·타임아웃 자동진행 | 시스템 |
| ARTIFACT_LINK | `"MSG-06"` | 산출물 링크 — docs 경로·Notion URL·PR | Agent |

### ChannelType · ConversationStatus

| 코드 | 값 | 설명 |
|------|-----|------|
| MAIN | `"main"` | CH-MAIN — 전역 단일 채널 |
| AGENT | `"agent"` | CH-AGENT — Agent당 1개 |

| 코드 | 값 | 설명 | 발화 |
|------|-----|------|:---:|
| ACTIVE | `"active"` | 활성 | ✅ |
| READONLY | `"readonly"` | Agent 종료 — 읽기 전용 | ❌ |
| ARCHIVED | `"archived"` | **Agent 삭제 — 보존** (D-27) | ❌ |

### SenderRole

| 코드 | 값 |
|------|-----|
| CEO | `"ceo"` |
| MAIN | `"main"` |
| AGENT | `"agent"` |
| SYSTEM | `"system"` |

### ApprovalType

| 코드 | 값 | 등급 | 타임아웃 |
|------|-----|------|:---:|
| GATE | `"APV-GATE"` | **높음 고정 — 하향 불가** | **없음** |
| ARCH | `"APV-ARCH"` | 높음 | 없음 |
| DEPLOY | `"APV-DEPLOY"` | 높음 | 없음 |
| EXT | `"APV-EXT"` | 높음 | 없음 |
| CHOICE | `"APV-CHOICE"` | 보통 | 30분 |
| RETRY | `"APV-RETRY"` | 보통 | 30분 |

### ApprovalStatus (5종)

| 코드 | 값 | 설명 |
|------|-----|------|
| PENDING | `"pending"` | 대기 |
| APPROVED | `"approved"` | 승인 |
| REJECTED | `"rejected"` | 반려 — **사유 필수** |
| CONDITIONAL | `"conditional"` | 조건부 승인 — **조건 필수** |
| AUTO_ADVANCED | `"auto_advanced"` | 타임아웃 자동 진행 — **APV-GATE 불가** |

### DecisionLevel

| 코드 | 값 | 적재 | 동작 |
|------|-----|:---:|------|
| HIGH | `"high"` | ✅ | 무기한 대기. 대표 처리 필수 |
| MEDIUM | `"medium"` | ✅ | 30분 후 자동 진행 (D-10) |
| LOW | `"low"` | ❌ | 자율 판단. `status_changes`에만 기록 |

> **`low`는 `approvals` 테이블에 적재되지 않는다.** 판정 분기용 상수로만 존재한다.

### SkillName · StageStatus

| 코드 | 값 | 게이트 |
|------|-----|:---:|
| PLAN | `"plan"` | → analyze **필수** |
| ANALYZE | `"analyze"` | — |
| DESIGN | `"design"` | — |
| DEVELOP | `"develop"` | — |
| TEST | `"test"` | → deploy **필수** |
| DEPLOY | `"deploy"` | — |
| OPERATE | `"operate"` | — |

| 코드 | 값 |
|------|-----|
| PENDING | `"pending"` |
| IN_PROGRESS | `"in_progress"` |
| COMPLETED | `"completed"` |

### WaitingReason (3종) — D-11

| 코드 | 값 | 타임아웃 |
|------|-----|:---:|
| CEO_APPROVAL | `"ceo_approval"` | 없음 (무기한) |
| CEO_DECISION | `"ceo_decision"` | 30분 |
| EXTERNAL_INPUT | `"external_input"` | — |

> `status !== 'waiting'`이면 반드시 NULL이다 (DES-003 v2 §3-4 CHECK 제약).

### ArtifactStatus · SyncStatus

| 코드 | 값 |
|------|-----|
| DRAFT | `"draft"` |
| REVIEW | `"review"` |
| APPROVED | `"approved"` |

| 코드 | 값 | 의미 |
|------|-----|------|
| SYNCED | `"synced"` | Notion·Git 양쪽 존재 |
| NOTION_ONLY | `"notion_only"` | **Git 동기화 누락** — 프로세스 위반 아님 |
| GIT_ONLY | `"git_only"` | Notion 승인 원본 없음 |
| MISSING | `"missing"` | 양쪽 없음 |

> **저장하지 않고 파생한다** (DES-003 v2 §4-4). `notion_only`와 `missing`의 구분이 이 Enum의 존재 이유다 — 2026-09-01 "analyze 건너뜀" 오진단이 둘을 혼동한 사고였다.

### EntityType 확장

| 코드 | 값 | 설명 |
|------|-----|------|
| PROJECT | `"project"` | 프로젝트 |
| AGENT | `"agent"` | 에이전트 |
| TASK | `"task"` | 태스크 |
| **CONVERSATION** | `"conversation"` | **대화 채널** (v3) |
| **APPROVAL** | `"approval"` | **승인** (v3) |
| **STAGE** | `"stage"` | **단계** (v3) |

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

### 대화·승인·진행 에러 코드 — **v3 신규 9종**

| 코드 | HTTP | 설명 | 발생 조건 |
|------|:---:|------|----------|
| CONVERSATION_NOT_FOUND | 404 | 대화 채널 없음 | 존재하지 않는 채널 ID |
| CONVERSATION_ARCHIVED | 409 | 읽기 전용 채널 | `readonly`·`archived` 채널에 발화 시도 |
| APPROVAL_NOT_FOUND | 404 | 승인 건 없음 | 존재하지 않는 승인 ID |
| APPROVAL_ALREADY_RESOLVED | 409 | 이미 처리된 승인 | `pending`이 아닌 건에 resolve |
| APPROVAL_REASON_REQUIRED | 400 | 사유 누락 | 반려·조건부 승인에 `reason` 없음 (안전장치 S-2) |
| GATE_AUTO_ADVANCE_FORBIDDEN | 422 | 게이트 자동 진행 불가 | `APV-GATE`에 `auto_advanced` 시도 |
| GATE_NOT_PASSED | 403 | 게이트 미통과 | 승인 없이 다음 단계 착수 시도 |
| WIP_VIOLATION | 409 | WIP 규칙 위반 | 면제 없이 WIP=1 초과 |
| STAGE_NOT_FOUND | 404 | 단계 없음 | 존재하지 않는 단계 ID |

> `PUSH_SUBSCRIPTION_INVALID`는 **Phase 2**다. 터널링 연기로 원격 접속이 Phase 2로 밀렸다.

#### WebSocket close code

| 코드 | 의미 |
|:---:|------|
| 1001 | Going Away — 서버 정상 종료 |
| 4001 | 인증 실패 — 토큰 없음·만료·무효 |
| 4004 | 대상 없음 — 채널 ID 부재 |

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

  // --- v3 신규: 대화·승인·진행 ---
  CONVERSATION_NOT_FOUND: "CONVERSATION_NOT_FOUND",
  CONVERSATION_ARCHIVED: "CONVERSATION_ARCHIVED",
  APPROVAL_NOT_FOUND: "APPROVAL_NOT_FOUND",
  APPROVAL_ALREADY_RESOLVED: "APPROVAL_ALREADY_RESOLVED",
  APPROVAL_REASON_REQUIRED: "APPROVAL_REASON_REQUIRED",
  GATE_AUTO_ADVANCE_FORBIDDEN: "GATE_AUTO_ADVANCE_FORBIDDEN",
  GATE_NOT_PASSED: "GATE_NOT_PASSED",
  WIP_VIOLATION: "WIP_VIOLATION",
  STAGE_NOT_FOUND: "STAGE_NOT_FOUND",
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

## 2026-09-01 승인 반영 현황

| 신규 Enum / 코드 | 상태 | 비고 |
|-----------------|:---:|------|
| `MessageType` (MSG-01~06) | ✅ **v3 반영** | §MessageType |
| `ChannelType` · `ConversationStatus` | ✅ **v3 반영** | `archived` 포함 (D-27) |
| `SenderRole` | ✅ **v3 반영** | v3에서 추가 인지 |
| `ApprovalType` | ✅ **v3 반영** | APV-GATE 등급 고정 명시 |
| `ApprovalStatus` | ✅ **v3 반영 (정정)** | 초안의 `expired` 제외 — 5종 |
| `DecisionLevel` | ✅ **v3 반영 (정정)** | `low`는 적재하지 않음을 명시 |
| `SkillName` · `StageStatus` | ✅ **v3 반영** | 게이트 필요 전환 2건 표기 |
| `WaitingReason` | ✅ **v3 반영 (정정)** | 초안 2종 → **3종** (D-11) |
| `ArtifactStatus` · `SyncStatus` | ✅ **v3 반영** | FR-031 동기화 추적 |
| `EntityType` 확장 3종 | ✅ **v3 반영** | conversation · approval · stage |
| 에러 코드 9종 | ✅ **v3 반영** | §대화·승인·진행 에러 코드 |
| WebSocket close code 3종 | ✅ **v3 반영** | 1001 · 4001 · 4004 |
| `NotificationType` (NTF-01~07) | ⏸️ **Phase 2** | 터널링 연기로 원격 알림이 Phase 2 |
| `PUSH_SUBSCRIPTION_INVALID` | ⏸️ **Phase 2** | 동일 |

---

## 미해결 사항

| 항목 | 내용 | 등급 | 처리 시점 |
|------|------|:---:|----------|
| **`src/shared/` 실제 파일 미작성** | 본 문서의 Enum·상수는 **정의**다. `src/shared/types.ts`·`constants.ts` 실제 파일은 develop에서 만든다 | 낮음 | develop |
| **Agent 유형 Enum 미확정** | Phase 1은 자유 텍스트다. 하네스가 6종으로 고정되어 있으므로 Enum화 여지가 있으나 Phase 1 범위 밖 | 낮음 | Phase 2 |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 (Phase 1 설계) |
| v1.1 | 2026-08-24 | Phase 2+ 확장 고려사항 추가 (FR-013~015) |
| v2.0 | 2026-08-24 | Phase 2~5 전체 Enum/타입 정의 확장 (FR-016~025) |
| — | 2026-09-01 | Git 동기화 + 승인 반영 필요 Enum·에러코드 정리 |
| **v3.0** | 2026-09-01 | **승인 반영 개정.** 대화·승인·진행 **Enum 12종** + **에러 코드 9종** + WebSocket close code 3종 확정.<br>**초안 대비 3건 정정** — `ApprovalStatus`에서 `expired` 제외(전이 맵에 없음), `DecisionLevel.low`는 적재하지 않음을 명시, `WaitingReason` 2종 → **3종**(무기한 대기와 30분 타임아웃 구분).<br>`EntityType` 3종 확장, `AgentStatus.waiting`에 사유 필드 표기, `ERROR_CODES` 상수 9종 추가. 미해결 2건 등록 |
