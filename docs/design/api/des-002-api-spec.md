# DES-002 API 명세서

> Phase 1: 기반 구축
> 버전: **v2.8 (2026-09-03)** — `POST /api/artifacts` upsert가 생략한 `notionUrl`·`gitPath`를 보존하도록 사양 정정(R2-03) · `POST /api/approvals` 요청 예시 필수 필드 누락 정정(NEW-03) · `PATCH /api/conversations/:id/read`(D-2) · `POST /api/artifacts`(D-3) 신설
> **원본**: [Notion DES-002](https://app.notion.com/p/3c5d066504ec81958497d54fc5ab9fd3) · Git 동기화 2026-09-03
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

---

## 1. 개정 요약

D-09(대화) · D-16(승인 게이트) · D-18(승인 통합) 반영으로 Phase 1 API가 두 배가 되었다.

| 구분 | v1 | v2 | v2.1 | v2.4 | v2.5 | **v2.6** |
|------|:---:|:---:|:---:|:---:|:---:|:---:|
| Phase 1 엔드포인트 | 16 | 31 | 33 | 34 | 35 | **36** |
| Phase 2 예정 | — | 10 | 10 | 10 | 10 | **10** |
| **총계** | 16 | 41 | 43 | 44 | 45 | **46** |

**v1에서 ❌였던 2건을 이번에 해소한다.**

| v1 미작성 항목 | v2 |
|---------------|-----|
| JSON Schema (Fastify 검증용) | ✅ §6 — 공통 정의 + 도출 규칙 + 예시 |
| 엔드포인트별 에러 코드 매핑 | ✅ §7 — 36종 전건 매핑 + 신규 코드 9종 |

> **Phase 1 36종의 내역 (v2.6 기준)**: 기존 16 + 대화 7(REST 6 + WS 1) + 승인·진행 **12** + 전역 WS 1 = **36**.
> v2.1에서 2종이 늘었다 — `POST /api/phases`(R-01 부트스트랩)와 `POST /api/approvals`(R-07 승인 건 생성). PLN-002 v3의 "16 → 31"은 **33으로 갱신**한다. 증감 +6.5%로 §5 범위 변경 트리거(±20%) 미발동.
> **v2.4에서 1종이 더 늘었다** — `POST /api/stages/:id/complete`(대표 결정 A안). §7 단계 상태 머신은 `pending → in_progress → completed` 선형인데 `completed`로 만드는 경로가 어디에도 없어, `start`의 가드 1("직전 단계가 `completed`인가")을 영원히 통과할 수 없는 플로우 단절이었다(R-01급 결함, 2026-09-02 교차 검증 누락분). 증감 +3%로 §5 범위 변경 트리거 미발동.
> **v2.5에서 1종이 더 늘었다** — `PATCH /api/conversations/:id/read`(대표 결정 D-2 A안). `ConversationService.markRead()`(DES-004 v2.4)는 이미 시그니처가 있었으나 호출하는 HTTP 라우트가 없어 `last_read_at`이 갱신되지 않고 `unreadCount`가 영원히 줄지 않는 플로우 단절이었다(FIND-02, 2026-09-03 test 스킬 리뷰 지적 · 런타임 재현 확정). 기각된 B안(`GET .../messages`의 부수효과로 markRead 호출)은 조회에 쓰기가 섞여 채택하지 않는다. Phase 1 엔드포인트 34 → **35**(+3%), §5 범위 변경 트리거 미발동.
> **v2.6에서 1종이 더 늘었다** — `POST /api/artifacts`(대표 결정 D-3). `ArtifactService.upsert()`(`artifact.service.ts:159`)는 구현되어 있었으나 호출자가 0건이라 `artifacts` 테이블에 행을 만드는 경로가 어느 설계 문서에도 없었다(REV-M-06 — 코드 결함이 아니라 설계 공백). PLN-001 FR-031 수용 기준 2건이 전부 "조회 시 표시"뿐이라 등록을 아무도 규정하지 않았고, 결과적으로 `artifacts`가 영구히 빈 테이블이 되어 FR-031 전체가 도달 불가능했다. `code` UNIQUE 기준 upsert이며 **`status`는 되돌리지 않는다**(승인 흐름이 별도 관리하는 값 — `artifact.repository.ts:139` 근거). Phase 1 엔드포인트 35 → **36**(+3%), §5 범위 변경 트리거 미발동.

---

## 2. 공통 규약

### 2-1. Base URL

```
http://127.0.0.1:3000/api
```

> 외부 접근용 HTTPS Base URL은 **Phase 2**에 추가된다. 터널링(D-19·D-29)이 비용 제약으로 Phase 2로 연기되었으므로 Phase 1은 루프백만 사용한다.

### 2-2. 인증

```
Authorization: Bearer <JWT>
```

인증 불필요: `POST /api/auth/login`, `GET /api/health`

### 2-3. 응답 형식

**성공 (단일)**
```json
{ "data": { } }
```

**성공 (목록 · 오프셋 페이지네이션)**
```json
{
  "data": [ ],
  "pagination": { "page": 1, "pageSize": 20, "total": 42, "totalPages": 3 }
}
```

**성공 (목록 · 커서 페이지네이션)** — 메시지 무한스크롤 전용
```json
{
  "data": [ ],
  "cursor": { "next": "eyJjcmVhdGVkQXQiOi4uLn0", "hasMore": true }
}
```

> **메시지는 오프셋 페이지네이션을 쓰지 않는다.** 스크롤 중 새 메시지가 들어오면 오프셋이 밀려 같은 메시지가 중복 표시된다. `created_at + id` 복합 커서를 Base64로 인코딩한다.

**에러**
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "프로젝트 이름은 필수입니다",
  "code": "VALIDATION_ERROR"
}
```

### 2-4. WebSocket 규약

| 항목 | 규약 |
|------|------|
| 인증 | 연결 시 `?token=<JWT>` 쿼리 파라미터. 헤더를 쓸 수 없는 브라우저 WebSocket API 때문 |
| 메시지 형식 | `{ "event": "<이름>", "data": { } }` |
| 재연결 | 클라이언트 책임. 지수 백오프 (1s → 2s → 4s → 최대 30s) |
| **누락 보충** | 재연결 후 **REST 조회로 보충**한다. WebSocket은 버퍼링하지 않는다 (NFR-003 수용 기준) |
| 하트비트 | 서버 → 클라이언트 30초 ping. 60초 무응답 시 종료 |

---

## 3. Phase 1 엔드포인트 (36종)

### 3-1. 기존 (16종)

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

> **`DELETE /api/agents/:id` 동작 변경 (D-27)**: Agent를 삭제해도 대화는 삭제하지 않는다. 해당 `conversations` 행을 `status='archived'`로 전환하고 `entity_snapshot`을 기록한다. 응답에 `archivedConversationId`를 포함한다. DES-003 v2 §3-1 참조.
>
> **미처리 승인 자동 마감 (v2.1 · R-04)**: 같은 트랜잭션에서 이 Agent가 요청한 `pending` 승인을 전건 마감한다 — `status='rejected'`, `resolution='system:agent_deleted'`, `reason='요청 Agent 삭제로 자동 마감'`, `resolved_at=now`. 응답에 `closedApprovalCount`를 포함한다.
> **마감하지 않으면 승인함에 영구히 남는다** — 승인해도 재개할 Agent가 없다. `resolution` 값으로 대표 반려와 구분된다. 상태를 늘리지 않고 기존 5종으로 처리한다(D-11과 같은 원칙).

```json
{ "data": { "archivedConversationId": "uuid", "closedApprovalCount": 2 } }
```

### 3-2. 대화 (7종) — D-09 · D-27 · **D-2**

| 메서드 | 경로 | 설명 | Story | 인증 |
|--------|------|------|-------|:---:|
| GET | `/api/conversations` | 채널 목록 + 미읽음 수 | FR-026 | ✅ |
| GET | `/api/conversations/:id/messages` | 메시지 조회 (커서) | FR-027 | ✅ |
| **PATCH** | **`/api/conversations/:id/read`** | **읽음 처리(`last_read_at` 갱신)** — v2.5 신규 (D-2) | **FR-027** | ✅ |
| POST | `/api/conversations/:id/messages` | 대표 발화 전송 | FR-027 | ✅ |
| GET | `/api/conversations/search` | 전 채널 전문 검색 (FTS5) | FR-027 | ✅ |
| GET | `/api/conversations/:id/export` | 마크다운 내보내기 | FR-027 | ✅ |
| WS | `/ws/conversations/:id` | 메시지 스트리밍 | NFR-003 | ✅ |

> **⚠ DES-013 §6-2의 `/api/decisions` 2종은 채택하지 않는다.**
> D-18로 `decision_requests`가 `approvals`에 통합되었으므로 엔드포인트도 `/api/approvals`로 일원화한다. `GET /api/decisions?status=pending` → `GET /api/approvals?status=pending`, `POST /api/decisions/:id/resolve` → `POST /api/approvals/:id/resolve`.

### 3-3. 승인·진행 (12종) — D-14 · D-16 · D-18 · R-01 · R-07 · A안 · **D-3**

| 메서드 | 경로 | 설명 | Story | 인증 |
|--------|------|------|-------|:---:|
| GET | `/api/phases/current` | 현재 Phase + 7단계 + WIP 검사 | FR-029 | ✅ |
| **POST** | **`/api/phases`** | **Phase 생성 (7단계 동시 생성)** — v2.1 신규 | **FR-029** | ✅ |
| **POST** | **`/api/approvals`** | **승인 건 생성 (예외 승인·직접 상정)** — v2.1 신규 | **FR-028** | ✅ |
| POST | `/api/stages/:id/start` | 단계 착수 (게이트 검증) | FR-030 | ✅ |
| **POST** | **`/api/stages/:id/complete`** | **단계 완료** — v2.4 신규 (A안) | **FR-030** | ✅ |
| GET | `/api/artifacts` | 단계별 산출물 + 동기화 상태 | FR-031 | ✅ |
| GET | `/api/artifacts/:id/content` | 산출물 본문 (검토 패널) | FR-031 | ✅ |
| **POST** | **`/api/artifacts`** | **산출물 등록 (`code` UNIQUE upsert)** — v2.6 신규 (D-3) | **FR-031** | ✅ |
| GET | `/api/approvals` | 승인 목록 | FR-028 | ✅ |
| GET | `/api/approvals/:id` | 승인 상세 | FR-028 | ✅ |
| POST | `/api/approvals/:id/resolve` | 승인·반려·조건부 | FR-028 | ✅ |
| POST | `/api/wip-waivers` | WIP 위반 무시 등록 | FR-029 | ✅ |

### 3-4. 실시간 (1종)

| 메서드 | 경로 | 설명 | Story | 인증 |
|--------|------|------|-------|:---:|
| WS | `/ws` | 전역 상태 변경 스트리밍 | NFR-003 | ✅ |

---

## 4. 신규 엔드포인트 상세 — 대화

### `GET /api/conversations`

**쿼리 파라미터**

| 이름 | 타입 | 필수 | 기본 | 설명 |
|------|------|:---:|------|------|
| `type` | `main` \| `agent` | | 전체 | 채널 종류 |
| `status` | `active` \| `readonly` \| `archived` | | `active` | 채널 상태 |
| `project` | UUID | | | 프로젝트 필터 |
| `from` / `to` | ISO 8601 | | | 생성 기간 |

**응답**
```json
{
  "data": [{
    "id": "uuid",
    "channelType": "agent",
    "entityId": "agent-uuid",
    "status": "active",
    "entitySnapshot": null,
    "title": "빌드 파이프라인 Agent",
    "unreadCount": 3,
    "lastMessageAt": "2026-09-01T15:00:00+09:00",
    "createdAt": "2026-09-01T10:00:00+09:00",
    "archivedAt": null
  }]
}
```

> `title`은 저장 값이 아니다. `status='archived'`면 `entitySnapshot.agentName`에서, 아니면 `agents` 조인으로 만든다. **Agent가 삭제되어도 이름이 나온다** (D-27).

> **`unreadCount`도 파생값이다 (v2.3 · DEV-D-05)**: `conversations.last_read_at` 이후에 도착한 메시지 수다. 경계는 `>`이므로 포인터와 같은 시각의 메시지는 읽은 것으로 본다. `last_read_at`이 NULL이면(한 번도 열지 않음) 전체가 미읽음이다. 상세는 DES-003 v2.2 §3-1.

> **CH-MAIN 주소 지정 (v2.1)**: `:id`는 **UUID 전용**이다(§6-3 `format: 'uuid'`). `/api/conversations/main/...` 같은 경로 별칭은 스키마 검증에서 걸린다.
> `cm chat main`과 웹 [Main] 진입은 **`GET /api/conversations?type=main`으로 id를 먼저 얻은 뒤** 그 UUID로 메시지 엔드포인트를 호출한다. CH-MAIN은 부분 유니크 인덱스로 전역 1개가 보장되므로 결과는 항상 1건이다 (DES-003 v2 §3-1).

### `GET /api/conversations/:id/messages`

| 이름 | 타입 | 기본 | 설명 |
|------|------|------|------|
| `cursor` | string | | 이전 응답의 `cursor.next` |
| `limit` | integer (1~100) | 50 | 조회 개수 |
| `direction` | `before` \| `after` | `before` | 커서 기준 방향 |

**응답** — `structured`는 `msgType='MSG-03'`일 때만 채워진다.
```json
{
  "data": [{
    "id": "uuid",
    "conversationId": "uuid",
    "msgType": "MSG-03",
    "senderRole": "agent",
    "body": "설계 개정을 완료했습니다.",
    "structured": {
      "summary": "DES-003 v2 개정 완료",
      "workDone": "테이블 11개 추가 정의",
      "artifacts": ["docs/design/data/des-003-data-model.md"],
      "openIssues": "FTS5 토크나이저 미확정"
    },
    "approvalId": null,
    "createdAt": "2026-09-01T15:00:00+09:00"
  }],
  "cursor": { "next": "eyJjcmVhdGVkQXQiOi4uLn0", "hasMore": true }
}
```

> `approvalId`는 `msgType='MSG-04'`(의사결정 요청)일 때 채워진다. `approvals.message_id`의 역방향이며, 프런트가 이 메시지를 **액션 버튼이 달린 강조 카드**로 렌더링하는 근거다 (DES-013 §3-2).

### `PATCH /api/conversations/:id/read` — **v2.5 신규 (D-2 A안)**

요청 본문 없음.

읽음 포인터(`conversations.last_read_at`)를 현재 시각으로 옮긴다. `cm chat main`·`cm chat agent`·`cm chat log`가 채널을 열 때 호출한다 (DES-006 v3.3 §4-5).

**응답 `200`** — `Conversation`. 갱신 직후 `unreadCount`는 `0`이다 — §4 `GET /api/conversations`의 파생 규칙과 같은 기준(`last_read_at` 이후 메시지 수, 경계는 `>`)이 적용된다.

| 검증 | 실패 시 |
|------|--------|
| 대상 채널이 존재하는가 | `404 CONVERSATION_NOT_FOUND` |

> **기각된 B안**: `GET /api/conversations/:id/messages`가 조회 부수효과로 `markRead()`를 호출하는 안. 조회(GET)에 쓰기가 섞이면 캐싱·재시도가 안전하지 않아진다 — REST 시맨틱을 어긴다. 전용 `PATCH` 엔드포인트(A안)를 채택한다.
> **`archived`·`readonly` 채널에도 허용한다.** 읽음 처리는 발화가 아니라 열람 기록이라 `CONVERSATION_ARCHIVED`를 던지지 않는다 — 종료된 채널의 과거 대화를 훑어도 미읽음 수는 줄어야 한다.
> `ConversationService.markRead()`는 DES-004 v2.4에 이미 시그니처가 있었으나 이 엔드포인트가 없어 호출 경로가 없었다(FIND-02). DES-004 v2.5 §14-1에 시퀀스를 신설한다.

### `POST /api/conversations/:id/messages`

**요청**
```json
{ "body": "대화 기능부터 진행해줘" }
```

- `msgType`은 항상 `MSG-01`, `senderRole`은 항상 `ceo`로 서버가 고정한다. **클라이언트가 지정할 수 없다.**
- 채널이 `readonly` 또는 `archived`면 `409 CONVERSATION_ARCHIVED`

### `GET /api/conversations/search`

| 이름 | 타입 | 필수 | 설명 |
|------|------|:---:|------|
| `q` | string (2자 이상) | ✅ | 검색어 |
| `type` / `status` / `from` / `to` | — | | 목록과 동일 |
| `limit` | integer (1~50) | | 기본 20 |

**응답** — FTS5 `snippet()`으로 하이라이트 구간을 만든다.
```json
{
  "data": [{
    "messageId": "uuid",
    "conversationId": "uuid",
    "conversationTitle": "빌드 파이프라인 Agent",
    "snippet": "…<mark>설계서</mark>를 개정했습니다…",
    "createdAt": "2026-09-01T15:00:00+09:00"
  }]
}
```

> **⚠ 한국어 검색 정확도는 DES-003 v2 §3-3의 미해결 사항에 걸려 있다.** `unicode61` 토크나이저는 조사 때문에 "설계서를"이 "설계서" 검색에 걸리지 않는다. develop 단계에서 `trigram`과 비교 후 확정한다.

### `GET /api/conversations/:id/export`

`Content-Type: text/markdown`, `Content-Disposition: attachment`. 응답 봉투(`{data:...}`)를 쓰지 않는 유일한 엔드포인트다.

### `WS /ws/conversations/:id`

| 이벤트 | 페이로드 | 발생 |
|--------|---------|------|
| `message:new` | 메시지 객체 | 새 메시지 |
| `message:typing` | `{ senderRole }` | Agent 응답 생성 중 |
| `approval:updated` | 승인 객체 | 이 채널의 승인 상태 변경 |

---

## 5. 신규 엔드포인트 상세 — 승인·진행

### `GET /api/phases/current`

```json
{
  "data": {
    "phase": { "id": "uuid", "number": 1, "name": "기반 구축", "currentStage": "design" },
    "stages": [{
      "id": "uuid", "skill": "plan", "status": "completed",
      "artifactCount": 5, "pendingApprovalCount": 0,
      "gate": { "required": true, "approvalId": "uuid", "passed": true }
    }],
    "wipViolations": [{
      "rule": "주요 단계 WIP = 1",
      "detail": "design과 develop이 동시에 in_progress",
      "waived": false
    }]
  }
}
```

- `gate.required`는 CLAUDE.md 스킬 전환 모드에서 파생한다 (`plan→analyze`, `test→deploy`만 `true`)
- `wipViolations`는 저장하지 않고 **조회 시점에 계산**한다

### `POST /api/phases` — **v2.1 신규 (R-01)**

Phase 행과 **그에 속한 7단계를 한 트랜잭션으로 생성**한다. 단계를 따로 만드는 엔드포인트는 두지 않는다 — `stages`는 `UNIQUE(phase_id, skill)`로 Phase당 정확히 7행이어야 하므로, 개별 생성을 허용하면 6행이나 8행인 Phase가 생길 수 있다.

**요청**
```json
{ "number": 2, "name": "웹 대시보드" }
```

**응답 `201`** — `GET /api/phases/current`와 같은 `PhaseCurrent` 형태. `stages` 7건이 전부 `pending`이다.

| 검증 | 실패 시 |
|------|--------|
| `number`가 이미 존재 | `409 VALIDATION_ERROR` (`phases_number_unique`) |
| `number` < 1 | `400 VALIDATION_ERROR` |

> **Phase 1 행은 이 엔드포인트로 만들지 않는다.** 서버 최초 기동 시 부트스트랩이 멱등 생성한다(아래 §5-1). 이 엔드포인트는 **Phase 2 이후**를 만드는 경로다.

### 5-1. 부트스트랩 — 서버 최초 기동 시 시드 (**v2.1 신규 · R-01**)

**API가 아니라 서버 `ready` 훅의 동작이다.** PLN-001 FR-026 수용 기준이 요구하는 "시스템이 최초 기동될 때 CH-MAIN 채널 1개가 자동 생성되고 삭제할 수 없다"의 구현 지점이며, 이것이 없으면 `cm chat main`·`cm progress`·`cm stage start`가 **빈 DB를 만나 전부 실패한다.**

| 순서 | 대상 | 동작 | 멱등 근거 |
|:---:|------|------|----------|
| 1 | `conversations` | `channel_type='main'` 1행 생성 | 부분 유니크 인덱스 `conversations_main_unique` |
| 2 | `phases` | `number=1` 1행 생성 | `phases_number_unique` |
| 3 | `stages` | Phase 1의 7단계 `pending` 생성 | `UNIQUE(phase_id, skill)` |

- **전부 `INSERT … ON CONFLICT DO NOTHING`이다.** 매 기동마다 실행해도 안전하다
- 순서가 중요하다 — `stages.phase_id`가 `phases`를 참조한다
- 실패하면 **서버를 기동시키지 않는다.** 시드 없이 뜬 서버는 대화도 진행 추적도 못 하므로 조용히 반쪽으로 도는 것보다 낫다

### `POST /api/stages/:id/start`

요청 본문 없음. **서버가 게이트를 검증한다.**

| 검증 | 실패 시 |
|------|--------|
| 직전 단계가 `completed`인가 | `422 INVALID_TRANSITION` |
| 게이트 필요 단계인데 `APV-GATE` 승인이 `approved`인가 | `403 GATE_NOT_PASSED` |
| WIP=1 위반인데 `wip_waivers`에 면제가 없는가 | `409 WIP_VIOLATION` |

> **이것이 FR-030(승인 게이트)의 실제 강제 지점이다.** 화면에서 버튼을 감추는 것만으로는 강제되지 않는다. CLI·API 직접 호출도 막아야 하므로 서버에서 검증한다.

### `POST /api/stages/:id/complete` — **v2.4 신규 (A안)**

요청 본문 없음.

| 검증 | 실패 시 |
|------|--------|
| 대상 단계가 존재하는가 | `404 STAGE_NOT_FOUND` |
| 단계 상태가 `in_progress`인가 (`pending`·`completed`는 거부) | `422 INVALID_TRANSITION` |

**응답 `200`** — `StageSummary`. `status='completed'`, `completed_at`을 기록한다.

**부수 효과**
1. `stages` 갱신 (`status='completed'`, `completed_at=now`)
2. `status_changes` 기록 (`entity_type='stage'`)
3. `WS /ws` → `stage:changed` 브로드캐스트

> **`phases.current_stage`는 이 엔드포인트가 바꾸지 않는다.** 다음 `POST /api/stages/:id/start`가 갱신한다. 완료와 착수를 분리해 두어야 `start`의 가드 1("직전 단계가 `completed`인가")이 의미를 갖는다 — 이 엔드포인트가 없으면 어떤 단계도 `completed`가 될 수 없어 가드 1을 영원히 통과할 수 없다.
>
> **선행 조건을 걸지 않는다.** 산출물 개수·승인 상태를 검사하지 않는다. 산출물이 충분한지는 대표가 판단할 일이다 — 여기에 검사를 걸면 `start`의 3단 게이트 검증(§7-1, DES-007)에 이은 **두 번째 강제 지점**이 생겨, R-03이 정리한 "게이트 강제는 `POST /api/stages/:id/start` 한 곳에서만"이 다시 흐려진다.

### `POST /api/approvals` — **v2.1 신규 (R-07)**

승인 건을 직접 상정한다. Agent·Main이 내부에서 올리는 경로(`ApprovalService.request()`)와 **같은 서비스 함수를 쓰되 HTTP로도 열어둔다.** DES-014 EVT-PH-5(WIP 경보 [예외 승인])가 이 엔드포인트를 호출한다.

**요청**
```json
{
  "approvalType": "APV-GATE",
  "level": "high",
  "subject": "design 단계 WIP 예외 승인",
  "options": [
    { "code": "A", "label": "예외 승인", "recommended": true },
    { "code": "B", "label": "반려" }
  ],
  "requestedBy": "main",
  "rationale": "설계 개정과 API 명세를 병행해야 한다",
  "impact": { "documents": ["DES-002", "DES-003"], "reversible": true },
  "stageId": "uuid",
  "conversationId": "uuid"
}
```

> **`requestedBy`는 필수다** (`approval.schema.ts:45` `required` — 누락 시 `400 VALIDATION_ERROR`). 안건을 올리는 주체(`main`·`agent:<id>` 등)를 식별한다 — `GET /api/approvals` 응답의 `requestedBy` 필드(§5 목록 예시)가 여기서 채워진다. **NEW-03 — v2.6에서 예시에 누락되어 있던 것을 정정.**

**응답 `201`** — `ApprovalDetail`. 부수 효과로 해당 채널에 `MSG-04`가 기록되고 `approval:created`가 브로드캐스트된다.

| 검증 | 실패 시 |
|------|--------|
| `level='low'` | `400 VALIDATION_ERROR` — `low`는 적재하지 않는다 |
| `approvalType='APV-GATE'`인데 `level≠'high'` | `422 VALIDATION_ERROR` — 게이트는 등급 하향 불가 (DB CHECK (4)) |
| `level='high'`인데 `deadlineAt` 지정 | `422 VALIDATION_ERROR` — 높음은 무기한 (DB CHECK (2)) |
| `conversationId` 채널이 `active`가 아님 | `409 CONVERSATION_ARCHIVED` |

> **`deadlineAt`은 클라이언트가 정하지 않는다.** 서버가 등급에서 파생한다 — `high`면 `null`, `medium`이면 `now + 30분`(D-10). 요청 본문에 실어도 `additionalProperties: false`로 걸린다.

> **CLI 화면은 Phase 1에 추가하지 않는다.** Phase 1의 호출자는 Agent·Main(내부)뿐이고, 대표가 직접 안건을 올리는 화면은 **Phase 2 웹 진행 보드**(EVT-PH-5)다. 이 엔드포인트는 DES-006 CLI 화면 수(v3.5 기준 34개)에 영향을 주지 않는다.

### `POST /api/artifacts` — **v2.6 신규 (D-3)**

산출물 행을 등록·갱신한다. `ArtifactService.upsert()`(DES-004 §전체 함수 시그니처 요약)는 이미 구현되어 있었으나 호출자가 없어 `artifacts` 테이블이 영구히 비어 있었다(REV-M-06). FR-031(산출물 동기화 추적)은 이 경로 없이는 도달 불가능했다.

**요청**
```json
{
  "stageId": "uuid",
  "code": "DES-016",
  "title": "신규 설계서",
  "notionUrl": "https://app.notion.com/p/…",
  "gitPath": "docs/design/des-016-example.md"
}
```

- `notionUrl`·`gitPath`는 둘 다 선택이다. 어느 한쪽만 오거나 둘 다 없어도 유효한 요청이다 — 그 조합에서 `syncStatus`를 파생시키는 것이 이 엔드포인트의 존재 이유다(DES-003 §4-4).

**응답 `200`** — `Artifact`. **`code` UNIQUE 기준 upsert**다.

| `code` 존재 여부 | 동작 |
|:---:|------|
| 신규 | `status='draft'`로 삽입 |
| 기존 | `stageId`·`title`·`updatedAt`은 갱신. `notionUrl`·`gitPath`는 **요청에 있을 때만** 갱신하고, 생략하면 기존 값을 유지한다(v2.8 · R2-03) |

> **`status`는 이 엔드포인트가 되돌리지 않는다.** upsert의 `SET` 절에 `status`가 없어 기존 값이 그대로 유지된다(`artifact.repository.ts:139` 주석 근거) — 산출물의 `draft → review → approved` 전이는 승인 흐름이 별도로 관리하는 값이라, 재등록 한 번에 `approved`가 `draft`로 되돌아가면 안 된다.
> **생략한 `notionUrl`·`gitPath`는 지워지지 않는다** (v2.8 · 대표 결정 R2-03 A안). upsert의 `SET` 절이 `COALESCE(excluded.notion_url, notion_url)` 형태라, 한쪽만 지정해 갱신해도 반대쪽이 보존된다. v2.6~v2.7 사양은 무조건 덮어쓰기여서, `--git-path`만 주고 재등록하면 `notion_url`이 NULL이 되어 `syncStatus`가 `synced → git_only`로 **조용히 퇴행**했다 — FR-031이 막으려던 바로 그 오판(2026-09-01 "analyze 건너뜀")을 기능 자체가 만들어내는 결함이었다. **트레이드오프**: 한 번 등록한 URL을 이 엔드포인트로는 지울 수 없다(대표 승인 시 인지).
> **`syncStatus`는 이 엔드포인트도 저장하지 않는다.** 응답의 `syncStatus`는 `GET /api/artifacts`와 동일하게 `notionUrl`·`gitPath` 유무에서 파생한다(DES-003 §4-4 4분기 표). 이 원칙은 어떤 엔드포인트도 깨지 않는다.

| 검증 | 실패 시 |
|------|--------|
| `code`·`title`·`stageId` 누락 | `400 VALIDATION_ERROR` |
| `stageId`가 존재하지 않음 | `404 STAGE_NOT_FOUND` |

> **호출자 (Phase 1)**: 대표가 `cm artifacts add --skill <skill> ...`(DES-006 v3.5 SCR-CH15)로 직접 등록한다. Agent가 산출물 생성 시 자동 등록하는 경로는 Phase 1 범위 밖이다 — Agent 하네스 자동 연동은 Phase 2 이후다.

### `GET /api/approvals`

| 이름 | 타입 | 기본 | 설명 |
|------|------|------|------|
| `status` | `pending` \| `approved` \| `rejected` \| `conditional` \| `auto_advanced` | 전체 | |
| `level` | `high` \| `medium` | 전체 | `low`는 적재되지 않음 |
| `type` | `APV-GATE` \| `APV-ARCH` \| `APV-DEPLOY` \| `APV-EXT` \| `APV-CHOICE` \| `APV-RETRY` | 전체 | |
| `sort` | `deadline` \| `created` | `deadline` | |

**응답 (목록 요약)** — `elapsed`·`remaining`은 서버가 계산해 내려준다. DES-014 승인함이 "경과 시간·기한"을 표시해야 하기 때문이다.
```json
{
  "data": [{
    "id": "uuid", "approvalType": "APV-GATE", "level": "high",
    "subject": "plan → analyze 전환 승인",
    "requestedBy": "main", "status": "pending",
    "deadlineAt": null,
    "elapsedSeconds": 7200, "remainingSeconds": null,
    "createdAt": "2026-09-01T13:00:00+09:00"
  }]
}
```

### `GET /api/approvals/:id`

목록 필드에 더해 `options` · `artifacts` · `rationale` · `impact` · `messageId` · `stageId`를 포함한다. **DES-014 검토 패널이 "안건·산출물·근거·영향"을 보여주는 근거다** — 이 4개가 없으면 대표는 "모르는 채 누르는" 상태가 된다.

```json
{
  "data": {
    "id": "uuid",
    "approvalType": "APV-GATE",
    "level": "high",
    "subject": "plan → analyze 전환 승인",
    "options": [
      { "code": "A", "label": "승인", "recommended": true },
      { "code": "B", "label": "반려" }
    ],
    "artifacts": [
      { "code": "PLN-001", "title": "요구사항 정의서", "notionUrl": "https://…", "gitPath": "docs/requirements/pln-001-requirements.md", "syncStatus": "synced" }
    ],
    "rationale": "Must 19건 전건 수용 기준 작성 완료",
    "impact": { "documents": ["PLN-002", "ANL-001"], "reversible": true },
    "messageId": "uuid",
    "stageId": "uuid",
    "status": "pending",
    "deadlineAt": null
  }
}
```

### `POST /api/approvals/:id/resolve`

**요청**
```json
{ "resolution": "A", "status": "approved", "reason": null }
```

**서버 검증 — DES-003 v2 §4-1의 CHECK 제약과 1:1 대응한다.**

| 규칙 | 실패 시 |
|------|--------|
| 이미 처리된 건인가 | `409 APPROVAL_ALREADY_RESOLVED` |
| `rejected`·`conditional`인데 `reason`이 비었는가 | `400 APPROVAL_REASON_REQUIRED` |
| `APV-GATE`인데 `auto_advanced`인가 | `422 GATE_AUTO_ADVANCE_FORBIDDEN` |
| `resolution`이 `options`에 없는 코드인가 | `400 VALIDATION_ERROR` |

**부수 효과** (트랜잭션 1건으로 처리)
1. `approvals` 갱신 (`status`, `resolution`, `reason`, `resolved_at`)
2. 해당 채널에 `MSG-01` 기록 — 대표 결정을 대화에 남긴다
3. `approved`·`conditional`·`auto_advanced`면 → 요청 Agent `waiting` → `running`
4. `rejected`면 → 요청 Agent를 **`waiting` 유지** + `MSG-01`에 사유 기록
5. WebSocket `approval:updated` 브로드캐스트

> **`stages`는 이 엔드포인트에서 바뀌지 않는다 (v2.1 정정 · R-03).**
> v2는 "`approved`이고 `APV-GATE`면 `stages.status='in_progress'` 전환"이라 적었으나, DES-007 v2 §7-1은 **"`POST /api/stages/:id/start`에서만 전이가 일어난다"**고 규정한다. 두 곳에서 같은 전이를 일으키면 3단 게이트 검증(직전 단계 완료 · 게이트 통과 · WIP)을 우회하는 경로가 생긴다.
> 승인은 **게이트를 열어둘 뿐**이고, 실제 착수는 대표가 `cm stage start`로 한다. 승인 직후 `GET /api/phases/current`의 `gate.passed`가 `true`로 바뀐다.
>
> **반려도 `stages`를 바꾸지 않는다.** "직전 단계로 복귀"는 하지 않는다 — 게이트의 효력은 **다음 단계 착수 차단이 유지되는 것**이고, 보완이 끝나면 새 `APV-GATE`를 발행해 다시 승인 사이클을 돈다.

### `GET /api/artifacts`

| 이름 | 타입 | 설명 |
|------|------|------|
| `stage` | UUID | 단계 필터 |
| `syncStatus` | `synced` \| `notion_only` \| `git_only` \| `missing` | **동기화 상태 필터** |

```json
{
  "data": [{
    "id": "uuid", "code": "ANL-001", "title": "분석 보고서",
    "status": "approved",
    "notionUrl": "https://app.notion.com/p/…",
    "gitPath": null,
    "syncStatus": "notion_only",
    "updatedAt": "2026-09-01T12:00:00+09:00"
  }]
}
```

> `syncStatus`는 저장 값이 아니라 `notionUrl`·`gitPath` 유무에서 파생한다 (DES-003 v2 §4-4). **`notion_only`와 `missing`을 구분하는 것이 이 필드의 목적이다** — 2026-09-01 "analyze 건너뜀" 오진단이 이 둘을 혼동한 사고였다.

### `POST /api/wip-waivers`

```json
{ "phaseId": "uuid", "rule": "주요 단계 WIP = 1", "reason": "설계 개정과 API 명세를 병행" }
```

`reason`은 필수다. 빈 문자열이면 `400 VALIDATION_ERROR`.

---

## 6. JSON Schema (Fastify 검증용) — v1 미작성 항목 해소

### 6-1. 도출 규칙

**DES-004 시퀀스 다이어그램의 TypeScript 타입에서 기계적으로 도출한다.** 타입을 두 곳에 손으로 유지하지 않는다.

| DES-004 타입 | Fastify Schema |
|-------------|----------------|
| `string` | `{ type: 'string' }` |
| `string` (UUID) | `{ type: 'string', format: 'uuid' }` |
| `string` (ISO 8601) | `{ type: 'string', format: 'date-time' }` |
| 유니온 리터럴 | `{ type: 'string', enum: [...] }` |
| `number` | `{ type: 'integer' }` 또는 `{ type: 'number' }` |
| `T \| null` | `{ type: ['string','null'] }` |
| 옵셔널 `?` | `required` 배열에서 제외 |

### 6-2. 공통 스키마 (`$ref`로 재사용)

```js
const commonSchemas = {
  $id: 'common',
  definitions: {
    uuid:      { type: 'string', format: 'uuid' },
    timestamp: { type: 'string', format: 'date-time' },
    error: {
      type: 'object',
      // required는 4필드 그대로다. details는 선택이며 필요한 응답에만 붙는다 (v2.2)
      required: ['statusCode', 'error', 'message', 'code'],
      properties: {
        statusCode: { type: 'integer' },
        error:      { type: 'string' },
        message:    { type: 'string' },
        code:       { type: 'string' },
        details:    { type: 'object', additionalProperties: true }
      }
    },
    pagination: {
      type: 'object',
      properties: {
        page: { type: 'integer' }, pageSize: { type: 'integer' },
        total: { type: 'integer' }, totalPages: { type: 'integer' }
      }
    },
    cursor: {
      type: 'object',
      properties: { next: { type: ['string','null'] }, hasMore: { type: 'boolean' } }
    }
  }
}
```

### 6-3. 예시 — `POST /api/conversations/:id/messages`

```js
const postMessageSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { $ref: 'common#/definitions/uuid' } }
  },
  body: {
    type: 'object',
    required: ['body'],
    additionalProperties: false,          // msgType·senderRole 주입 차단
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 10000 }
    }
  },
  response: {
    201: {
      type: 'object',
      properties: { data: { $ref: 'message#' } }
    },
    409: { $ref: 'common#/definitions/error' }
  }
}
```

> **`additionalProperties: false`는 필수다.** 없으면 클라이언트가 `senderRole: "agent"`를 실어 보내 **대표 발화를 Agent 보고로 위장**할 수 있다.

### 6-4. 예시 — `POST /api/approvals/:id/resolve`

```js
const resolveApprovalSchema = {
  params: {
    type: 'object', required: ['id'],
    properties: { id: { $ref: 'common#/definitions/uuid' } }
  },
  body: {
    type: 'object',
    required: ['status'],
    additionalProperties: false,
    properties: {
      status:     { type: 'string', enum: ['approved','rejected','conditional'] },
      resolution: { type: ['string','null'] },
      reason:     { type: ['string','null'] }
    },
    // 반려·조건부는 사유 필수 (승인 안전장치 S-2)
    allOf: [{
      if:   { properties: { status: { enum: ['rejected','conditional'] } } },
      then: { required: ['reason'], properties: { reason: { type: 'string', minLength: 1 } } }
    }]
  }
}
```

> `enum`에 `auto_advanced`와 `pending`이 없다. **타임아웃 자동 진행은 스케줄러만 수행하며 API로 호출할 수 없다.**

### 6-5. 적용 규칙

- 모든 엔드포인트에 `body`·`params`·`querystring`·`response` 스키마를 붙인다
- **`response` 스키마도 붙인다.** Fastify는 응답 직렬화에 스키마를 쓰므로 성능 이득이 있고, 의도치 않은 필드 유출(예: 비밀 값)을 막는다
- 스키마 파일 위치: `src/backend/schemas/` (DES-008)

---

## 7. 에러 코드 매핑 — v1 미작성 항목 해소

### 7-1. 신규 에러 코드 9종

| 코드 | HTTP | 설명 | 발생 조건 |
|------|:---:|------|----------|
| `CONVERSATION_NOT_FOUND` | 404 | 대화 채널 없음 | 존재하지 않는 채널 ID |
| `CONVERSATION_ARCHIVED` | 409 | 읽기 전용 채널 | `readonly`·`archived` 채널에 발화 시도 |
| `APPROVAL_NOT_FOUND` | 404 | 승인 건 없음 | 존재하지 않는 승인 ID |
| `APPROVAL_ALREADY_RESOLVED` | 409 | 이미 처리된 승인 | `pending`이 아닌 건에 resolve |
| `APPROVAL_REASON_REQUIRED` | 400 | 사유 누락 | 반려·조건부 승인에 `reason` 없음 (S-2) |
| `GATE_AUTO_ADVANCE_FORBIDDEN` | 422 | 게이트 자동 진행 불가 | `APV-GATE`에 `auto_advanced` 시도 |
| `GATE_NOT_PASSED` | 403 | 게이트 미통과 | 승인 없이 다음 단계 착수 시도 |
| `WIP_VIOLATION` | 409 | WIP 규칙 위반 | 면제 없이 WIP=1 초과 |
| `STAGE_NOT_FOUND` | 404 | 단계 없음 | 존재하지 않는 단계 ID |

> DES-009 §에러 코드에 위 9종을 편입해야 한다. DES-009는 `PUSH_SUBSCRIPTION_INVALID`도 예고했으나 **Phase 2 항목**이라 여기서는 제외한다.

### 7-2. 엔드포인트별 매핑

모든 엔드포인트가 공통으로 던질 수 있는 코드: `VALIDATION_ERROR`(400) · `UNAUTHORIZED`(401) · `INTERNAL_ERROR`(500). 아래 표는 **그 외에 추가로 던지는 코드**만 적는다.

| 엔드포인트 | 추가 에러 코드 |
|-----------|--------------|
| `GET /api/health` | — (인증 불필요) |
| `POST /api/auth/login` | `AUTH_INVALID_SECRET` |
| `POST /api/projects` | `PROJECT_NAME_CONFLICT` |
| `GET /api/projects` | — |
| `GET /api/projects/:id` | `PROJECT_NOT_FOUND` |
| `PATCH /api/projects/:id/status` | `PROJECT_NOT_FOUND`, `INVALID_TRANSITION` |
| `POST /api/agents` | `PROJECT_NOT_FOUND`, `AGENT_NAME_CONFLICT`, `PARENT_NOT_ACTIVE` |
| `GET /api/agents` | — |
| `GET /api/agents/:id` | `AGENT_NOT_FOUND` |
| `PATCH /api/agents/:id/status` | `AGENT_NOT_FOUND`, `INVALID_TRANSITION`, `PARENT_NOT_ACTIVE` |
| `DELETE /api/agents/:id` | `AGENT_NOT_FOUND` |
| `POST /api/tasks` | `AGENT_NOT_FOUND`, `PARENT_NOT_ACTIVE` |
| `GET /api/tasks` | — |
| `GET /api/tasks/:id` | `TASK_NOT_FOUND` |
| `PATCH /api/tasks/:id/status` | `TASK_NOT_FOUND`, `INVALID_TRANSITION` |
| `GET /api/status-changes` | — |
| `GET /api/conversations` | — |
| `GET /api/conversations/:id/messages` | `CONVERSATION_NOT_FOUND` |
| `POST /api/conversations/:id/messages` | `CONVERSATION_NOT_FOUND`, **`CONVERSATION_ARCHIVED`** |
| `GET /api/conversations/search` | — |
| `GET /api/conversations/:id/export` | `CONVERSATION_NOT_FOUND` |
| `PATCH /api/conversations/:id/read` | `CONVERSATION_NOT_FOUND` |
| `GET /api/phases/current` | `NOT_FOUND` (진행 중 Phase 없음) |
| `POST /api/phases` | — (`number` 중복은 `VALIDATION_ERROR`) |
| `POST /api/approvals` | `CONVERSATION_NOT_FOUND`, **`CONVERSATION_ARCHIVED`**, `STAGE_NOT_FOUND` |
| `POST /api/stages/:id/start` | `STAGE_NOT_FOUND`, **`GATE_NOT_PASSED`**, **`WIP_VIOLATION`**, `INVALID_TRANSITION` |
| `POST /api/stages/:id/complete` | `STAGE_NOT_FOUND`, `INVALID_TRANSITION` |
| `GET /api/artifacts` | — |
| `GET /api/artifacts/:id/content` | `NOT_FOUND` |
| `POST /api/artifacts` | `STAGE_NOT_FOUND` |
| `GET /api/approvals` | — |
| `GET /api/approvals/:id` | `APPROVAL_NOT_FOUND` |
| `POST /api/approvals/:id/resolve` | `APPROVAL_NOT_FOUND`, **`APPROVAL_ALREADY_RESOLVED`**, **`APPROVAL_REASON_REQUIRED`**, **`GATE_AUTO_ADVANCE_FORBIDDEN`** |
| `POST /api/wip-waivers` | `NOT_FOUND` (Phase 없음) |
| `WS /ws`, `WS /ws/conversations/:id` | 연결 거부 시 close code `4001`(인증 실패) · `4004`(대상 없음) |

---

## 8. Phase 2 예정 (10종)

> 터널링(D-19·D-29)이 Phase 2로 연기되어 원격 접속 관련은 전부 Phase 2다.

| 구분 | 메서드 | 경로 | 기능 |
|------|--------|------|------|
| 페어링 | POST | `/api/auth/pair` | 페어링 토큰 → JWT 교환 (FR-032) |
| 푸시 | POST | `/api/push/subscribe` | Web Push 구독 등록 (FR-033) |
| 푸시 | DELETE | `/api/push/subscribe/:id` | 구독 해제 (기기 분실) |
| 푸시 | GET | `/api/push/vapid-public-key` | VAPID 공개키 조회 |
| 알림 | GET | `/api/notification-settings` | 알림 설정 조회 |
| 알림 | PATCH | `/api/notification-settings` | 알림 설정 변경 (D-26) |
| 실시간 | WS | `/ws/agents/:id/logs` | Agent 실시간 로그 (FR-014) |
| 정적 | GET | `/manifest.json` | PWA 매니페스트 |
| 정적 | GET | `/sw.js` | Service Worker |
| 정적 | GET | `/p/:token` | 페어링 단축 URL |

Phase 2~3 확장 후보(FR-013 `worktrees`)는 v1.1 기재를 유지한다.

---

## 9. 미해결 사항 (해소 이력 포함)

| 항목 | 내용 | 등급 | 처리 시점 |
|------|------|:---:|----------|
| ~~DES-004 타입 추가 정의~~ | ✅ **반영 완료 (2026-09-01)** — DES-004 v2에 대화·승인·진행 타입 27종 추가. §6 도출 규칙의 입력이 확보되었다 | 보통 | 완료 |
| ~~DES-009 에러 코드 편입~~ | ✅ **반영 완료 (2026-09-01)** — DES-009 v3 §대화·승인·진행 에러 코드 | 낮음 | 완료 |
| ~~타임아웃 스케줄러 배치 위치~~ | ✅ **확정 완료 (2026-09-01)** — DES-001 v3 **ADR-012**: Fastify 프로세스 내부 타이머. SQLite 단일 쓰기자 전제와 충돌하는 별도 워커안 기각 | 보통 | 완료 |
| **JSON Schema 전건 작성** | §6은 규칙 + 예시 2건이다. 36종 전건 스키마는 develop에서 DES-004 타입으로부터 생성하고 결과를 역반영한다 | 낮음 | develop |
| ~~읽음 처리 경로 부재 (FIND-02)~~ | ✅ **반영 완료 (2026-09-03)** — `PATCH /api/conversations/:id/read` 신설(대표 결정 D-2 A안). `markRead()` 시그니처는 있었으나 호출 라우트가 없어 `unreadCount`가 줄지 않는 상태였다 | 보통 | 완료 |
| ~~산출물 등록 경로 부재 (REV-M-06)~~ | ✅ **반영 완료 (2026-09-03)** — `POST /api/artifacts` 신설(대표 결정 D-3). `artifacts` 테이블에 행을 만드는 경로가 없어 FR-031이 도달 불가능한 상태였다 | 높음 | 완료 |
| ~~`POST /api/approvals` 요청 예시 `requestedBy` 누락 (NEW-03)~~ | ✅ **정정 완료 (2026-09-03)** — §5 요청 예시가 스키마 필수 필드 `requestedBy`를 빠뜨려 문서대로 호출하면 400이 났다. 예시 정정 + 전 요청 예시를 `src/backend/schemas/**`와 전건 대조(그 외 결함 없음 확인) | 보통 | 완료 |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 (엔드포인트 목록 16개) |
| v1.1 | 2026-08-24 | Phase 2+ 확장 고려사항 추가 |
| — | 2026-09-01 | Git 동기화 + 상세 스키마 미작성 지적 + 승인 반영 엔드포인트 25종 정리 |
| **v2** | 2026-09-01 | **승인 반영 전면 개정.** Phase 1 엔드포인트 16 → 31종(대화 6 · 승인·진행 8 · 전역 WS 1), Phase 2 예정 10종 분리.<br>**v1의 ❌ 2건 해소** — JSON Schema 도출 규칙·공통 정의·예시(§6), 에러 코드 매핑 31종 전건 + **신규 코드 9종**(§7).<br>신규 14종 요청/응답 스키마 상세, **커서 페이지네이션** 도입(메시지 중복 방지), WebSocket 규약 신설, `/api/decisions` 2종 폐기(D-18 통합), `POST /api/stages/:id/start`를 **FR-030 게이트의 실제 강제 지점**으로 명시. 미해결 4건 등록 |
| **v2.1** | 2026-09-02 | **교차 검증 반영 (승인 R-01·R-03·R-04·R-07).** Phase 1 엔드포인트 **31 → 33** (+6.5%, §5 범위 트리거 미발동).<br>**`POST /api/phases` 신규** — Phase + 7단계 동시 생성. **§5-1 부트스트랩 신설** — 서버 `ready` 훅에서 CH-MAIN·Phase 1·7단계를 멱등 시드. 이 경로가 없어 `cm chat main`·`cm progress`·`cm stage start`가 빈 DB에서 전부 실패하는 상태였다(R-01).<br>**`POST /api/approvals` 신규** — 승인 건 직접 상정. DES-014 EVT-PH-5가 이미 호출하고 있었으나 API 목록에 없었다(R-07). CLI 화면은 Phase 1에 추가하지 않는다(32화면 유지).<br>**`resolve` 부수 효과 정정** — 승인이 `stages`를 직접 전이시키던 것을 제거했다. DES-007 v2 §7-1의 "`stages/:id/start`에서만 전이"와 충돌해 3단 게이트 검증 우회 경로가 되었다. 반려도 단계를 되돌리지 않는다(R-03).<br>**`DELETE /api/agents/:id`에 pending 승인 자동 마감 추가** — `resolution='system:agent_deleted'`. 없으면 승인함에 영구 잔류했다(R-04) |
| — | 2026-09-02 | (문서 내 언급 대비 변경 이력 행 누락) `details` 선택 필드 추가(v2.2, §6-2) · `unreadCount` 파생 근거 명시(v2.3, §4, DEV-D-05). 두 건 모두 엔드포인트 개수에는 영향 없음 |
| **v2.4** | 2026-09-02 | **단계 완료 경로 신설 (대표 결정 A안) — 플로우 단절 보완.** `POST /api/stages/:id/complete` 신규, Phase 1 엔드포인트 **33 → 34**(+3%, §5 범위 변경 트리거 미발동 — 테이블 증감 없음·Must 스토리 증감 없음·Layer 추가 없음).<br>Layer 2-8 개발 중 발견 — DES-007 §7 단계 상태 머신은 `pending → in_progress → completed` 선형인데, `completed`로 만드는 경로가 이 문서·DES-006 CLI 명세 어디에도 없어 `start`의 가드 1("직전 단계가 `completed`인가")을 영원히 통과할 수 없었다. R-01(부트스트랩 주체 부재)과 같은 성격의 결함이며 2026-09-02 교차 검증에서 놓친 건이다.<br>**선행 조건 없음** — 산출물 개수·승인 상태를 검사하지 않는다. `start`의 3단 게이트 검증 외에 두 번째 강제 지점을 만들지 않기 위해서다(R-03 취지 보존). `phases.current_stage`는 이 엔드포인트가 바꾸지 않는다 — 다음 `start`가 갱신한다. §7-2 에러 매핑에 `STAGE_NOT_FOUND`·`INVALID_TRANSITION` 2종 추가 |
| **v2.5** | 2026-09-03 | **읽음 처리 경로 신설 (대표 결정 D-2 A안) — FIND-02 해소.** `PATCH /api/conversations/:id/read` 신규, Phase 1 엔드포인트 **34 → 35**(+3%, §5 범위 변경 트리거 미발동). test 스킬 9단계 리뷰에서 `ConversationService.markRead()`를 호출하는 HTTP 라우트가 없어 `last_read_at`이 갱신되지 않고 `unreadCount`가 영원히 줄지 않음이 런타임으로 재현 확정됐다. 기각된 B안(`GET .../messages` 부수효과 markRead)은 조회에 쓰기가 섞여 채택하지 않는다. `archived`·`readonly` 채널에도 허용(발화가 아닌 열람 기록). §7-2 에러 매핑에 `CONVERSATION_NOT_FOUND` 매핑 추가 |
| **v2.6** | 2026-09-03 | **산출물 등록 경로 신설 (대표 결정 D-3) — REV-M-06 해소.** `POST /api/artifacts` 신규, Phase 1 엔드포인트 **35 → 36**(+3%, §5 범위 변경 트리거 미발동). `ArtifactService.upsert()`는 구현되어 있었으나 호출자가 0건이라 `artifacts`가 영구히 빈 테이블이었고, PLN-001 FR-031 수용 기준 2건이 전부 "조회 시 표시"뿐이라 등록 자체가 어느 설계 문서에도 규정된 적이 없었다(코드 결함이 아니라 설계 공백). `code` UNIQUE 기준 upsert, **`status`는 되돌리지 않는다**(`artifact.repository.ts:139`), `syncStatus`는 계속 파생값(DES-003 §4-4)이다. §7-2 에러 매핑에 `STAGE_NOT_FOUND` 매핑 추가 |
| **v2.7** | 2026-09-03 | **`POST /api/approvals` 요청 예시 결함 정정 (NEW-03, test 스킬 발견) — 문서 결함.** §5 요청 예시에 스키마 필수 필드 `requestedBy`(`approval.schema.ts:45`)가 빠져 있어 **문서대로 호출하면 400이 났다.** 예시에 `"requestedBy": "main"` 추가 + 필수 각주 신설. 겸해 DES-002 전 요청 예시를 `src/backend/schemas/**`(common·approval·phase·artifact) 4개 파일과 전건 대조 — 그 외 결함 없음(`POST /api/phases`·`POST /api/wip-waivers`·`POST /api/artifacts`·`POST /api/approvals/:id/resolve`·§6-3/6-4 스키마 예시 전건 스키마와 일치 확인). 엔드포인트 수·동작 변경 없음(예시 정정만) |
| **v2.8** | 2026-09-03 | **`POST /api/artifacts` upsert 갱신 규칙 정정 (대표 결정 R2-03 A안) — 사양 결함 해소.** v2.6~v2.7 사양은 `notionUrl`·`gitPath`를 **무조건 덮어쓰도록** 규정했다. 그 결과 `cm artifacts add --code DES-001 --title T --git-path p`처럼 한쪽만 지정해 기존 `synced` 행을 갱신하면 `notion_url`이 NULL이 되어 `syncStatus`가 **`synced → git_only`로 조용히 퇴행**했다 — FR-031이 막으려던 바로 그 오판(2026-09-01 "analyze 건너뜀"은 `notion_only`를 `missing`으로 오판한 사고였다)을 기능 자체가 만들어내는 구조였다. **`COALESCE(excluded.<col>, <col>)` 적용** — 요청에 있을 때만 갱신하고 생략하면 기존 값을 유지한다. `stageId`·`title`·`updatedAt`은 필수 입력이라 그대로 덮어쓰고, `status`는 종전대로 `SET` 절 밖이다(승인 이력 보호). **트레이드오프**: 한 번 등록한 URL을 이 엔드포인트로는 지울 수 없다 — 대표가 인지하고 승인했다(드문 조작). 실기동 확인: `--notion-url` 생략 재등록 후에도 `notionUrl` 보존·`syncStatus: synced` 유지(구현 정합 확인: 커밋 `b15a835`) |
