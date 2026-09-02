# DES-008 디렉토리 구조

> Phase 1: 기반 구축
> 버전: v2.0 (2026-08-24)
> **원본**: [Notion DES-008](https://app.notion.com/p/3c5d066504ec8173acafd9d2396552fa) · Git 동기화 2026-09-01
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

---

## 전체 구조

C4 Component Diagram (DES-001)에서 도출한 파일 구조.

```
src/
├── backend/
│   ├── app.ts                    # Fastify 앱 설정 (플러그인 등록, 라우트 등록)
│   ├── server.ts                 # 진입점 (listen + graceful shutdown)
│   ├── config.ts                 # 서버 설정 (환경 변수 로드)
│   ├── plugins/
│   │   ├── database.ts           # SQLite + Drizzle 연결 플러그인
│   │   └── auth.ts               # JWT 인증 플러그인 (preHandler)
│   ├── routes/
│   │   ├── health.routes.ts      # GET /api/health
│   │   ├── auth.routes.ts        # POST /api/auth/login
│   │   ├── projects.routes.ts    # /api/projects/*
│   │   ├── agents.routes.ts      # /api/agents/*
│   │   ├── tasks.routes.ts       # /api/tasks/*
│   │   └── status-changes.routes.ts  # /api/status-changes
│   ├── services/
│   │   ├── auth.service.ts       # 인증 비즈니스 로직
│   │   ├── project.service.ts    # 프로젝트 CRUD + 상태 전이
│   │   ├── agent.service.ts      # Agent CRUD + 상태 전이
│   │   ├── task.service.ts       # Task CRUD + 상태 전이
│   │   └── status-change.service.ts  # 상태 변경 이력 기록/조회
│   ├── repositories/
│   │   ├── project.repository.ts     # 프로젝트 데이터 액세스
│   │   ├── agent.repository.ts       # Agent 데이터 액세스
│   │   ├── task.repository.ts        # Task 데이터 액세스
│   │   └── status-change.repository.ts  # 상태 변경 이력 데이터 액세스
│   ├── db/
│   │   ├── schema.ts             # Drizzle ORM 테이블 스키마
│   │   ├── index.ts              # DB 연결 인스턴스 생성
│   │   └── migrations/           # drizzle-kit 생성 마이그레이션 파일
│   │       └── 0000_initial.sql  # 초기 마이그레이션
│   └── utils/
│       ├── errors.ts             # 커스텀 에러 클래스
│       └── state-machine.ts      # 상태 전이 검증 (순수 함수)
├── cli/
│   ├── index.ts                  # Commander 진입점
│   ├── commands/
│   │   ├── auth.ts               # cm auth login/logout/status
│   │   ├── project.ts            # cm project create/list/status
│   │   ├── agent.ts              # cm agent create/list/status
│   │   └── task.ts               # cm task create/list/status
│   ├── api-client.ts             # HTTP 클라이언트 래퍼 (undici)
│   └── config.ts                 # CLI 설정 (토큰 저장/로드)
├── shared/
│   ├── types.ts                  # 공유 TypeScript 타입/인터페이스
│   ├── constants.ts              # 상태 Enum, 에러 코드, 상수
│   └── state-transitions.ts      # 상태 전이 규칙 데이터 (백엔드/CLI 공유)
└── frontend/                     # Phase 2 (빈 디렉토리, 구조만)
    └── .gitkeep

tests/
├── unit/
│   ├── backend/
│   │   ├── services/
│   │   │   ├── project.service.test.ts
│   │   │   ├── agent.service.test.ts
│   │   │   ├── task.service.test.ts
│   │   │   └── status-change.service.test.ts
│   │   ├── routes/
│   │   │   ├── projects.routes.test.ts
│   │   │   ├── agents.routes.test.ts
│   │   │   └── tasks.routes.test.ts
│   │   └── utils/
│   │       └── state-machine.test.ts
│   └── cli/
│       └── api-client.test.ts
└── fixtures/
    └── test-db.ts                # 테스트용 인메모리 DB 설정

data/                             # SQLite DB 파일 (gitignore)
    └── claude-manager.db
```

## Component → 디렉토리 매핑

| Component (C4) | 디렉토리 | 파일 패턴 |
|---------------|---------|----------|
| Database Plugin | backend/plugins/ | database.ts |
| Auth Plugin | backend/plugins/ | auth.ts |
| Auth Routes | backend/routes/ | auth.routes.ts |
| Auth Service | backend/services/ | auth.service.ts |
| Project Routes | backend/routes/ | projects.routes.ts |
| Project Service | backend/services/ | project.service.ts |
| Project Repository | backend/repositories/ | project.repository.ts |
| Agent Routes | backend/routes/ | agents.routes.ts |
| Agent Service | backend/services/ | agent.service.ts |
| Agent Repository | backend/repositories/ | agent.repository.ts |
| Task Routes | backend/routes/ | tasks.routes.ts |
| Task Service | backend/services/ | task.service.ts |
| Task Repository | backend/repositories/ | task.repository.ts |
| StatusChange Routes | backend/routes/ | status-changes.routes.ts |
| StatusChange Service | backend/services/ | status-change.service.ts |
| StatusChange Repository | backend/repositories/ | status-change.repository.ts |
| State Machine | backend/utils/ | state-machine.ts |
| Health Routes | backend/routes/ | health.routes.ts |
| CLI Entry | cli/ | index.ts |
| CLI Commands | cli/commands/ | {resource}.ts |
| API Client | cli/ | api-client.ts |
| CLI Config | cli/ | config.ts |
| Shared Types | shared/ | types.ts, constants.ts |
| State Transitions | shared/ | state-transitions.ts |
| Drizzle Schema | backend/db/ | schema.ts |
| Migrations | backend/db/migrations/ | {number}_{name}.sql |

## 프로젝트 루트 설정 파일

```
/                              # 프로젝트 루트
├── package.json               # 루트 (npm workspaces)
├── tsconfig.json              # 루트 TypeScript 설정
├── tsconfig.base.json         # 공통 TypeScript 설정
├── drizzle.config.ts          # Drizzle Kit 설정
├── .env                       # 환경 변수 (gitignore)
├── .env.example               # 환경 변수 템플릿
├── .gitignore
└── CLAUDE.md
```

## npm Workspaces 구성

```json
{
  "name": "claude-manager",
  "private": true,
  "workspaces": [
    "src/backend",
    "src/cli",
    "src/shared"
  ]
}
```

| 패키지 | package.json name | 의존 |
|--------|------------------|------|
| src/shared | @claude-manager/shared | — |
| src/backend | @claude-manager/backend | @claude-manager/shared |
| src/cli | @claude-manager/cli | @claude-manager/shared |

## 파일명 규칙

- 소스 파일: kebab-case (예: `project.service.ts`)
- 테스트 파일: `{name}.test.ts`
- 라우트 파일: `{리소스 복수형}.routes.ts`
- 서비스 파일: `{리소스 단수형}.service.ts`
- 레포지토리 파일: `{리소스 단수형}.repository.ts`
- 마이그레이션 파일: `{번호}_{설명}.sql` (drizzle-kit 자동 생성)

## .gitignore 주요 항목

```
node_modules/
dist/
data/
.env
*.db
*.db-journal
```

---

## Phase 2+ 확장 고려사항

> Orca ADE 분석 결과 반영 (2026-08-24).

| 기능 | 예상 디렉토리/파일 추가 | 대상 Phase |
|------|---------------------|:---:|
| 실시간 Agent Board (FR-014) | `src/backend/services/log-streamer.service.ts`, `src/frontend/components/AgentBoard/` | 2 |
| 비용/토큰 추적 (FR-016) | `src/backend/services/usage.service.ts`, `.../repositories/usage.repository.ts`, `.../routes/usage.routes.ts`, `src/frontend/components/CostDashboard/` | 2 |
| 칸반 보드 (FR-017) | `src/frontend/components/KanbanBoard/` (Frontend 전용) | 2 |
| ~~승인 게이트 (FR-018)~~ | **Phase 1로 편입 완료 (D-16)** — `src/backend/services/approval.service.ts`, `.../repositories/approval.repository.ts`, `.../routes/approvals.routes.ts`는 Phase 1 구조에 포함. `src/frontend/components/ApprovalQueue/`만 Phase 2 | ~~2~~ → **1** |
| 워크트리 기반 격리 (FR-013) | `src/backend/services/worktree.service.ts`, `.../routes/worktrees.routes.ts`, `.../repositories/worktree.repository.ts` | 3 |
| 워크플로우 템플릿 (FR-019) | `src/backend/services/template.service.ts`, `.../repositories/template.repository.ts`, `.../routes/templates.routes.ts` | 3 |
| 공유 메모리 (FR-020) | `src/backend/services/memory.service.ts`, `.../repositories/memory.repository.ts`, `.../routes/memories.routes.ts` | 3 |
| 세션 관리 (FR-021) | `src/backend/services/session.service.ts`, `.../repositories/session.repository.ts`, `.../routes/sessions.routes.ts` | 3 |
| 모바일 모니터링 PWA (FR-015) | `src/frontend/public/manifest.json`, `src/frontend/service-worker.ts`, `src/backend/services/push.service.ts` | ~~4~~ → **2** (D-23) |
| 오케스트레이션 DAG (FR-022) | `src/frontend/components/OrchestrationView/` (Frontend 전용) | 4 |
| 알림/웹훅 (FR-023) | `src/backend/services/notification.service.ts`, `.../repositories/notification.repository.ts`, `.../routes/notifications.routes.ts` | 4 |
| 롤백/체크포인트 (FR-024) | `src/backend/services/checkpoint.service.ts`, `.../repositories/checkpoint.repository.ts` | 5 |
| 성과 분석 (FR-025) | `src/frontend/components/Analytics/` (Frontend 전용) | 5 |

**현재 구조와의 호환성**: 3-Layer (routes/services/repositories) 패턴을 그대로 따르므로 기존 디렉토리 구조에 자연스럽게 추가 가능.

- Frontend 전용 기능(칸반, DAG, 분석)은 `src/frontend/components/`에만 추가
- Backend 기능은 routes/services/repositories 3파일 세트로 추가

---

## ⚠ 2026-09-01 승인 반영 필요

승인된 결정에 따라 **Phase 2·4 예정이던 아래 디렉토리가 Phase 1~2로 앞당겨진다.**

| 기능 | 디렉토리 | 기존 Phase | 변경 후 | 근거 |
|------|---------|:---:|:---:|------|
| 대화 채널 | `backend/services/conversation.service.ts`, `.../repositories/conversation.repository.ts`, `.../routes/conversations.routes.ts`, `cli/commands/chat.ts` | (없음) | **1** | D-09 |
| 승인 게이트 | `backend/services/approval.service.ts` 외 3파일, `cli/commands/approvals.ts`, `cli/commands/review.ts` | 2 | **1** | D-16 |
| 진행 추적 | `backend/services/phase.service.ts`, `.../artifact.service.ts`, `cli/commands/progress.ts` | (없음) | **1** | D-16 |
| PWA | `frontend/public/manifest.json`, `frontend/service-worker.ts`, `backend/services/push.service.ts` | 4 | **2** | D-23 |
| 페어링 | `backend/routes/pairing.routes.ts`, `cli/commands/pair.ts`, `cli/commands/devices.ts` | (없음) | **2** | D-19 |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 (Phase 1 설계) |
| v1.1 | 2026-08-24 | Phase 2+ 확장 고려사항 추가 (FR-013~015) |
| v2.0 | 2026-08-24 | Phase 2~5 전체 디렉토리/파일 확장 반영 (FR-016~025) |
| — | 2026-09-01 | **Git 동기화** + 승인 반영 필요 항목 주석 추가 (내용 변경 없음) |
