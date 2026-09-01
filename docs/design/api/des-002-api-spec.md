# DES-002 API 명세서

> Phase 1: 기반 구축
> 버전: **v2 (2026-09-01)** — 승인 반영 개정. Phase 1 엔드포인트 16 → 31종
> **원본**: [Notion DES-002](https://app.notion.com/p/3c5d066504ec81958497d54fc5ab9fd3) · Git 동기화 2026-09-01
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

---

## 1. 개정 요약

D-09(대화) · D-16(승인 게이트) · D-18(승인 통합) 반영으로 Phase 1 API가 두 배가 되었다.

| 구분 | v1 | **v2** |
|------|:---:|:---:|
| Phase 1 엔드포인트 | 16 | **31** |
| Phase 2 예정 | — | **10** |
| **총계** | 16 | **41** |

**v1에서 ❌였던 2건을 이번에 해소한다.**

| v1 미작성 항목 | v2 |
|---------------|-----|
| JSON Schema (Fastify 검증용) | ✅ §6 — 공통 정의 + 도출 규칙 + 예시 |
| 엔드포인트별 에러 코드 매핑 | ✅ §7 — 31종 전건 매핑 + 신규 코드 9종 |

> **Phase 1 31종의 내역**: 기존 16 + 대화 6(REST 5 + WS 1) + 승인·진행 8 + 전역 WS 1 = 31. PLN-002 v3의 "API 엔드포인트 16 → 31(Phase 1분)"과 일치한다.

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

## 3. Phase 1 엔드포인트 (31종)

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

### 3-2. 대화 (6종) — D-09 · D-27

| 메서드 | 경로 | 설명 | Story | 인증 |
|--------|------|------|-------|:---:|
| GET | `/api/conversations` | 채널 목록 + 미읽음 수 | FR-026 | ✅ |
| GET | `/api/conversations/:id/messages` | 메시지 조회 (커서) | FR-027 | ✅ |
| POST | `/api/conversations/:id/messages` | 대표 발화 전송 | FR-027 | ✅ |
| GET | `/api/conversations/search` | 전 채널 전문 검색 (FTS5) | FR-027 | ✅ |
| GET | `/api/conversations/:id/export` | 마크다운 내보내기 | FR-027 | ✅ |
| WS | `/ws/conversations/:id` | 메시지 스트리밍 | NFR-003 | ✅ |

> **⚠ DES-013 §6-2의 `/api/decisions` 2종은 채택하지 않는다.**
> D-18로 `decision_requests`가 `approvals`에 통합되었으므로 엔드포인트도 `/api/approvals`로 일원화한다. `GET /api/decisions?status=pending` → `GET /api/approvals?status=pending`, `POST /api/decisions/:id/resolve` → `POST /api/approvals/:id/resolve`.

### 3-3. 승인·진행 (8종) — D-14 · D-16 · D-18

| 메서드 | 경로 | 설명 | Story | 인증 |
|--------|------|------|-------|:---:|
| GET | `/api/phases/current` | 현재 Phase + 7단계 + WIP 검사 | FR-029 | ✅ |
| POST | `/api/stages/:id/start` | 단계 착수 (게이트 검증) | FR-030 | ✅ |
| GET | `/api/artifacts` | 단계별 산출물 + 동기화 상태 | FR-031 | ✅ |
| GET | `/api/artifacts/:id/content` | 산출물 본문 (검토 패널) | FR-031 | ✅ |
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

### `POST /api/stages/:id/start`

요청 본문 없음. **서버가 게이트를 검증한다.**

| 검증 | 실패 시 |
|------|--------|
| 직전 단계가 `completed`인가 | `422 INVALID_TRANSITION` |
| 게이트 필요 단계인데 `APV-GATE` 승인이 `approved`인가 | `403 GATE_NOT_PASSED` |
| WIP=1 위반인데 `wip_waivers`에 면제가 없는가 | `409 WIP_VIOLATION` |

> **이것이 FR-030(승인 게이트)의 실제 강제 지점이다.** 화면에서 버튼을 감추는 것만으로는 강제되지 않는다. CLI·API 직접 호출도 막아야 하므로 서버에서 검증한다.

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
3. `approved`이고 `APV-GATE`면 → `stages.status='in_progress'` 전환
4. `rejected`면 → 요청 Agent를 `waiting` 유지 + `MSG-01`에 사유 기록
5. WebSocket `approval:updated` 브로드캐스트

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
      required: ['statusCode', 'error', 'message', 'code'],
      properties: {
        statusCode: { type: 'integer' },
        error:      { type: 'string' },
        message:    { type: 'string' },
        code:       { type: 'string' }
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
| `GET /api/phases/current` | `NOT_FOUND` (진행 중 Phase 없음) |
| `POST /api/stages/:id/start` | `STAGE_NOT_FOUND`, **`GATE_NOT_PASSED`**, **`WIP_VIOLATION`**, `INVALID_TRANSITION` |
| `GET /api/artifacts` | — |
| `GET /api/artifacts/:id/content` | `NOT_FOUND` |
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

## 9. 미해결 사항

| 항목 | 내용 | 등급 | 처리 시점 |
|------|------|:---:|----------|
| **DES-004 타입 추가 정의** | DES-004에 대화·승인·진행 타입이 없다. `Conversation`·`Message`·`Approval`·`Phase`·`Stage`·`Artifact` 타입을 추가해야 §6 도출 규칙이 성립한다 | **보통** | DES-004 개정 시 |
| **DES-009 에러 코드 편입** | §7-1 신규 9종을 DES-009 코드 정의서에 반영해야 한다 | 낮음 | DES-009 개정 시 |
| **타임아웃 스케줄러 명세 없음** | `medium` 등급 30분 자동 진행(D-10)을 누가 언제 실행하는지 설계에 없다. API가 아니라 서버 내부 잡이라 DES-001 아키텍처에 넣어야 한다 | **보통** | DES-001 개정 시 |
| **JSON Schema 전건 작성** | §6은 규칙 + 예시 2건이다. 31종 전건 스키마는 develop에서 DES-004 타입으로부터 생성하고 결과를 역반영한다 | 낮음 | develop |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 (엔드포인트 목록 16개) |
| v1.1 | 2026-08-24 | Phase 2+ 확장 고려사항 추가 |
| — | 2026-09-01 | Git 동기화 + 상세 스키마 미작성 지적 + 승인 반영 엔드포인트 25종 정리 |
| **v2** | 2026-09-01 | **승인 반영 전면 개정.** Phase 1 엔드포인트 16 → 31종(대화 6 · 승인·진행 8 · 전역 WS 1), Phase 2 예정 10종 분리.<br>**v1의 ❌ 2건 해소** — JSON Schema 도출 규칙·공통 정의·예시(§6), 에러 코드 매핑 31종 전건 + **신규 코드 9종**(§7).<br>신규 14종 요청/응답 스키마 상세, **커서 페이지네이션** 도입(메시지 중복 방지), WebSocket 규약 신설, `/api/decisions` 2종 폐기(D-18 통합), `POST /api/stages/:id/start`를 **FR-030 게이트의 실제 강제 지점**으로 명시. 미해결 4건 등록 |
