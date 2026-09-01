# DES-002 API 명세서

> Phase 1: 기반 구축
> 작성일: 2026-08-23
> **원본**: [Notion DES-002](https://app.notion.com/p/3c5d066504ec81958497d54fc5ab9fd3) · Git 동기화 2026-09-01
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

> **⚠ 상세 명세는 DES-004에 있다**
> Notion 원본이 참조하는 `docs/design/api/api-spec.md`는 **존재한 적이 없다.** 본 문서에는 엔드포인트 목록 16개만 남아 있다.
> 다만 **요청/응답 타입과 함수 시그니처는 [DES-004 시퀀스 다이어그램](../des-004-sequence-dataflow.md)에 전부 정의되어 있다.** dev-sub는 DES-004를 계약서로 삼으면 된다.
> 실제로 빠진 것은 **JSON Schema(Fastify 검증용)와 엔드포인트별 에러 코드 매핑** 2가지다. → §미작성 항목 참조.

> **⚠ 개정 대기 (2026-09-01 승인 반영) — 규모 중**
> 승인된 결정에 따라 **엔드포인트 25종 추가**가 필요하다. §승인 반영 필요 참조.

---

## 공통 규약

### Base URL

```
http://127.0.0.1:3000/api
```

> D-19(터널링) 승인에 따라 외부 접근용 HTTPS Base URL이 추가된다. DES-015 §2-2 참조.

### 인증

보호된 엔드포인트는 Authorization 헤더에 Bearer 토큰을 포함해야 한다.

```
Authorization: Bearer <JWT>
```

인증 불필요 엔드포인트: `POST /api/auth/login`, `GET /api/health`

### 공통 응답 형식

**성공 (단일 리소스)**

```json
{
  "data": { }
}
```

**성공 (목록)**

```json
{
  "data": [ ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 42,
    "totalPages": 3
  }
}
```

**에러**

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "프로젝트 이름은 필수입니다",
  "code": "VALIDATION_ERROR"
}
```

---

## 엔드포인트 목록 (Phase 1 · 16개)

| 리소스 | 메서드 | 경로 | 설명 | Story | 인증 |
|--------|--------|------|------|-------|:---:|
| Health | GET | `/api/health` | 서버 상태 확인 | FR-001 | — |
| Auth | POST | `/api/auth/login` | 로그인 (JWT 발급) | FR-002 | — |
| Project | POST | `/api/projects` | 프로젝트 생성 | FR-003 | ✅ |
| Project | GET | `/api/projects` | 프로젝트 목록 조회 | FR-004 | ✅ |
| Project | GET | `/api/projects/:id` | 프로젝트 상세 조회 | FR-005 | ✅ |
| Project | PATCH | `/api/projects/:id/status` | 프로젝트 상태 변경 | FR-006 | ✅ |
| Agent | POST | `/api/agents` | Agent 생성 | FR-007 | ✅ |
| Agent | GET | `/api/agents` | Agent 목록 조회 | FR-007 | ✅ |
| Agent | GET | `/api/agents/:id` | Agent 상세 조회 | FR-007 | ✅ |
| Agent | PATCH | `/api/agents/:id/status` | Agent 상태 변경 | FR-007 | ✅ |
| Agent | DELETE | `/api/agents/:id` | Agent 삭제 | FR-007 | ✅ |
| Task | POST | `/api/tasks` | Task 생성 | FR-008 | ✅ |
| Task | GET | `/api/tasks` | Task 목록 조회 | FR-008 | ✅ |
| Task | GET | `/api/tasks/:id` | Task 상세 조회 | FR-008 | ✅ |
| Task | PATCH | `/api/tasks/:id/status` | Task 상태 변경 | FR-008 | ✅ |
| StatusChange | GET | `/api/status-changes` | 상태 변경 이력 조회 | FR-009 | ✅ |

---

## 🔴 미작성 항목 (develop 착수 전 필수)

아래는 **어디에도 정의되어 있지 않다.** DES-006 화면 명세서에서 각 엔드포인트가 반환해야 할 필드는 유추 가능하나, 정식 스키마가 없다.

| 항목 | 상태 | 대체 참조 |
|------|------|----------|
| 엔드포인트별 **요청 본문 타입** | ✅ **DES-004에 있음** | `CreateProjectInput`, `CreateAgentInput`, `CreateTaskInput`, `LoginRequest` 등 |
| 엔드포인트별 **응답 본문 타입** | ✅ **DES-004에 있음** | `Project`, `ProjectDetail`, `Agent`, `Task`, `StatusChange`, `LoginResponse`, `HealthResponse` |
| **쿼리 파라미터** 명세 | ✅ **DES-004에 있음** | `ListProjectsOpts`, `ListStatusChangesOpts` 등 |
| **JSON Schema** (Fastify 검증용) | ❌ **없음** | 타입은 DES-004에 있으나 Fastify용 Schema 객체는 미작성 |
| 엔드포인트별 **에러 코드 매핑** | ❌ **없음** | 에러 코드 목록은 DES-009에 있으나 "어느 엔드포인트가 어떤 코드를 던지는지" 매핑이 없음 |

> **권고**: DES-004의 타입 정의에서 JSON Schema를 기계적으로 도출할 수 있으므로 부담은 크지 않다. `develop` 착수 시 dev-sub가 DES-004 타입 → Fastify Schema 변환을 함께 수행하고, 그 결과를 DES-002에 역반영한다.

---

## Phase 2+ 확장 고려사항 (원본)

> Orca ADE 분석 결과 반영 (2026-08-24).

| 기능 | 예상 API 확장 | 대상 Phase |
|------|-------------|:---:|
| 워크트리 기반 격리 (FR-013) | `POST /api/worktrees`, `DELETE /api/worktrees/:id`, `GET /api/agents/:id/worktree` | 2~3 |
| 실시간 Agent Board (FR-014) | WebSocket 이벤트: `agent:log`, `agent:progress`, `agent:command` | 2 |
| 모바일 모니터링 PWA (FR-015) | 기존 REST 그대로 + `POST /api/push/subscribe`, `DELETE /api/push/unsubscribe` | 4 |

**현재 API와의 호환성**: Phase 1의 REST 엔드포인트 구조(`/api/{resource}`)를 유지하며 새 리소스만 추가. 기존 API 변경 없음.

---

## ⚠ 2026-09-01 승인 반영 필요 — 엔드포인트 25종 추가

### 대화 (DES-013 §6-2) — D-09, D-27 승인 · 6종

| 메서드 | 경로 | 기능 |
|--------|------|------|
| GET | `/api/conversations?type=&status=&project=&from=&to=` | 채널 목록 + 미읽음 수 |
| GET | `/api/conversations/:id/messages` | 메시지 조회 (커서 페이지네이션) |
| POST | `/api/conversations/:id/messages` | 대표 발화 전송 |
| GET | `/api/conversations/search?q=` | 전 채널 전문 검색 (FTS5) |
| GET | `/api/conversations/:id/export` | 마크다운 내보내기 |
| WS | `/ws/conversations/:id` | 메시지 스트리밍 |

### 승인·진행 (DES-014 §7-2) — D-14, D-16, D-18 승인 · 8종

| 메서드 | 경로 | 기능 |
|--------|------|------|
| GET | `/api/phases/current` | 현재 Phase + 7단계 상태 + WIP 검사 결과 |
| POST | `/api/stages/:id/start` | 단계 착수 (게이트 통과 검증) |
| GET | `/api/artifacts?stage=` | 단계별 산출물 + 동기화 상태 |
| GET | `/api/artifacts/:id/content` | 산출물 본문 (검토 패널 미리보기) |
| GET | `/api/approvals?status=&level=&type=` | 승인 목록 |
| GET | `/api/approvals/:id` | 승인 상세 (안건·산출물·근거·영향) |
| POST | `/api/approvals/:id/resolve` | 승인·반려·조건부 승인 |
| POST | `/api/wip-waivers` | WIP 위반 무시 등록 |

### 모바일 (DES-015 §7-2) — D-19, D-21, D-23 승인 · 6종

| 메서드 | 경로 | 기능 |
|--------|------|------|
| POST | `/api/auth/pair` | 페어링 토큰 → JWT 교환 |
| POST | `/api/push/subscribe` | Web Push 구독 등록 |
| DELETE | `/api/push/subscribe/:id` | 구독 해제 (기기 분실 시) |
| GET | `/api/push/vapid-public-key` | VAPID 공개키 조회 |
| GET | `/api/notification-settings` | 알림 설정 조회 |
| PATCH | `/api/notification-settings` | 알림 설정 변경 |

### 기타 · 로그 스트리밍 · 정적 자산 · 5종

| 항목 | 경로 | 기능 |
|------|------|------|
| WS | `/ws` | 전역 상태 변경 스트리밍 |
| WS | `/ws/agents/:id/logs` | Agent 실시간 로그 |
| 정적 | `/manifest.json` | PWA 매니페스트 |
| 정적 | `/sw.js` | Service Worker |
| 정적 | `/p/:token` | 페어링 단축 URL |

**합계: 기존 16종 + 신규 25종 = 41종**

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 (엔드포인트 목록 16개) |
| v1.1 | 2026-08-24 | Phase 2+ 확장 고려사항 추가 |
| — | 2026-09-01 | **Git 동기화** + 상세 스키마 미작성 지적 + 승인 반영 엔드포인트 25종 정리 |
