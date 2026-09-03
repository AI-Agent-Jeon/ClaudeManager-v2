# TST-007 인수 테스트 시나리오 (UAT)

> Phase 1 테스트
> 버전: v1.1 (2026-09-03)
> **원본**: [Notion TST-007](https://app.notion.com/p/3d0d066504ec81ec8e4ef248c17f7db9) · Git 동기화 2026-09-03
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

---

## 목적과 범위

PLN-002 §Phase 완료 조건(v3, 통합 진행 기준) 9개 항목을 대표(1인 CEO) 관점에서 실제로 조작해 통과 여부를 판정하는 시나리오다. 근거 문서는 DES-005(스토리보드) · DES-006(CLI 34화면 명세) · DES-007(상태 흐름도) · PLN-001(수용 기준)이며, 근거 문서에 없는 조작·출력은 만들지 않고 §명세 공백에 남긴다.

> **⚠ 커버리지 공백 (2026-09-03, test 9단계 수정 루프 2차 신설분)**: 본 시나리오 작성(v1) 이후 D-2·D-3 반영으로 신설된 `PATCH /api/conversations/:id/read` · `POST /api/artifacts` 엔드포인트 2종과 SCR-CH15(`cm artifacts add`) 화면 1종은 **본 UAT 시나리오가 다루지 않는다.** 이번 루프 신설분은 단위·통합 테스트로 커버되며(`docs/test-reports/cases/test-cases.md` 참조), UAT 시나리오는 **다음 루프에서 보강**한다 — 대표 관점의 조작 시나리오가 없다고 해서 테스트되지 않은 것은 아니다.

### PLN-002 완료 조건 ↔ 시나리오 대응표

| # | 완료 조건 | 대응 시나리오 |
|:---:|----------|--------------|
| 1 | Walking Skeleton 전체 동작(서버 기동→…→CLI 조회) | TC-UA-001 |
| 2 | Must 스토리 19개 전건 구현 및 단위 테스트 통과 | TC-UA-005 |
| 3 | DB 마이그레이션 체계 동작 확인 | TC-UA-002 |
| 4 | API 인증 미들웨어 동작 확인 | TC-UA-003 |
| 5 | CLI에서 기본 명령 실행 가능 | TC-UA-004 |
| 6 | 대화가 서버 재시작 후에도 보존됨(Agent 삭제 시 archived 확인 포함) | TC-UA-006 |
| 7 | `plan→analyze` 게이트가 실제로 차단됨 | TC-UA-007 |
| 8 | 등급별 동작 검증: 높음/보통/낮음 | TC-UA-008, TC-UA-009, TC-UA-010 |
| 9 | CLI에서 `cm chat`, `cm inbox`, `cm decide`, `cm progress` 실행 가능 | TC-UA-011 |

추가로 요구된 예외 흐름(에러·취소·타임아웃·미인증·게이트 차단)은 위 시나리오 내부의 분기점으로도 다루되, **cross-cutting 성격이 강한 것은 TC-UA-012~014로 별도 구성**했다.

---

## 시나리오 본문

### TC-UA-001: Walking Skeleton 전체 흐름

- **대응 완료 조건**: #1
- **목적**: 서버 기동 → 인증 → 프로젝트 생성 → Agent 등록 → 상태 로그 → 대화 1왕복 → 의사결정 1건 승인 → Agent 재개 → CLI 조회가 하나의 세션에서 끊김 없이 동작하는지 확인한다
- **사전 조건**: DB 파일 없음(최초 실행), Node.js 18+ 설치됨
- **근거**: DES-005 시나리오 1~4·6·7, PLN-002 Walking Skeleton 재정의(v2)

**단계별 조작 및 기대 결과**

| # | 조작(CLI) | 기대 화면/출력(화면 ID) | 판정 기준 |
|:---:|----------|------------------------|----------|
| 1 | `npm run server:start` | 배너 + 초기 시크릿 + 마이그레이션 로그(SCR-S01) | 프로세스가 `Listening on http://127.0.0.1:3000` 출력 |
| 2 | `curl http://127.0.0.1:3000/api/health` | `{"status":"ok",...}` | HTTP 200 |
| 3 | `cm auth login` (PRM-01, 시크릿 입력) | `✓ 인증 성공` + 토큰 저장 경로 + 만료일(SCR-A01) | `cm auth status`에서 "인증됨" 확인 |
| 4 | `cm project create --name "cm-v2" --description "Phase 1 검증"` | 전체 UUID·이름·`status: ready`(SCR-P01) | 응답 `201`, `status=ready` |
| 5 | `cm project status <id> --set running` | `ready → running`(SCR-P04) | `status=running` |
| 6 | `cm agent create --project <id> --name "dev-01" --type "dev-sub" --skill "develop"` | 전체 UUID·`status: created`(SCR-AG01) | Agent 생성 + **CH-AGENT 채널 동시 개설**(FR-026, 한 트랜잭션) |
| 7 | `cm agent status <agentId> --set running` | `created → running`(SCR-AG04) | `status=running` |
| 8 | `cm status-changes --entity-type agent --entity-id <agentId>` | 시각·From·To·변경자 표(SCR-SC01) | 6·7단계 변경이 시간순으로 기록됨 |
| 9 | `cm chat agent <agentId>` 진입 후 발화 1건 전송(대표) | `[대표]` 1행 전송 표시(SCR-CH02) | `MSG-01` 저장 확인(`cm chat log <채널id>`로 재확인) |
| 10 | Agent가 등급 '높음' 의사결정 요청 발행(내부 트리거, §명세 공백 4 참조 — 검증 시 `POST /api/approvals`로 동등 효과 시뮬레이션) | ⚠ 카드(`MSG-04`, SCR-CH01/02) + `cm inbox`에 표시(SCR-CH04) | Agent `waiting`/`waiting_reason=ceo_approval` |
| 11 | `cm review <승인id>` | 안건·선택지·근거·영향 범위(SCR-CH08) | 4개 항목 전부 출력 |
| 12 | `cm decide <승인id> --approve` | `✓ 승인 완료` + Agent 재개 안내(SCR-CH05) | Agent `waiting → running` |
| 13 | `cm agent status <agentId>` | Agent 상세(SCR-AG03) | `status=running` 재확인 |
| 14 | `cm project list` | 표(ID·이름·상태·생성일, SCR-P02) | 1개 프로젝트, `running` |

- **판정 기준(종합)**: 위 14단계가 오류 없이 순서대로 완료되고, 최종적으로 프로젝트 `running` · Agent `running` · 대화 1왕복 기록 · 승인 1건 `approved` 상태가 모두 확인된다
- **예외 흐름**: 각 단계 실패 시 대응은 TC-UA-012~016 및 DES-005 각 시나리오의 분기점 표를 따른다

---

### TC-UA-002: DB 마이그레이션 체계 동작 확인

- **대응 완료 조건**: #3
- **목적**: 신규 마이그레이션이 순서대로 적용되고, 이미 적용된 마이그레이션은 재실행되지 않는지 확인한다
- **사전 조건**: TC-UA-001로 최초 기동을 마친 상태(DB 파일 존재)
- **근거**: DES-005 시나리오 1 Moment 2, PLN-001 DAT-002

**단계별 조작**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | (최초 기동 로그 재확인) `npm run server:start` 최초 1회 로그 | `[migrate] Running migration 0000_initial.sql` ~ 최신 마이그레이션까지 순서대로 출력 | 파일명 오름차순 적용 |
| 2 | 서버 재시작(`Ctrl+C` → `npm run server:start`) | `Database: ./data/cm.db (existing)` + "No pending migrations"류 안내 | 이미 적용된 마이그레이션 재실행 안 함 |

- **판정 기준(종합)**: 마이그레이션이 파일명 순서대로 1회만 적용되고, `schema.ts`가 실제 스키마와 일치한다(개발 산출물 `tests/unit/backend/db/schema.test.ts` 통과로 교차 확인)
- **예외 흐름**: 마이그레이션 실패 시 동작(롤백 상세)은 TST-001 §명세 공백 3에 등록되어 있어, 이 시나리오에서는 정상 흐름만 판정한다. 실패 흐름은 develop 단계 보완 후 본 시나리오에 추가한다

---

### TC-UA-003: API 인증 미들웨어 동작 확인 (미인증 예외 흐름 포함)

- **대응 완료 조건**: #4
- **목적**: 인증 없는 API 접근이 차단되고, 유효 토큰만 통과하는지 확인한다
- **사전 조건**: 서버 실행 중
- **근거**: PLN-001 NFR-002, DES-006 §8 공통 에러

**단계별 조작**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | 로그인하지 않은 상태에서 `cm project list` | `✗ 인증이 필요합니다` | 401 상당 CLI 에러, 명령 실행 거부 |
| 2 | `curl -H "Authorization: Bearer invalid" http://127.0.0.1:3000/api/projects` | `401 Unauthorized` | JSON 에러 응답 4필드(statusCode/error/message/code) |
| 3 | `cm auth login` 후 재시도: `cm project list` | 정상 표 출력 | 200, 프로젝트 목록 표시 |
| 4 | 토큰 만료 후(또는 만료로 간주되는 토큰 사용) `cm project list` | `✗ 토큰이 만료되었습니다` + `cm auth login` 안내 | 401 + 재로그인 안내 문구 존재 |

- **판정 기준(종합)**: 1·2·4단계는 전부 거부, 3단계만 통과 — NFR-002의 EP 4분류(토큰 없음/무효/만료/유효)가 CLI에서 실제로 구분된다
- **예외 흐름(미인증)**: 위 1·2·4단계 자체가 미인증 예외 흐름이다

---

### TC-UA-004: CLI 기본 명령 실행 가능 확인

- **대응 완료 조건**: #5
- **목적**: `project`·`agent`·`task`·`status-changes` 4개 명령군이 CLI에서 CRUD 전 과정 실행 가능한지 확인한다
- **사전 조건**: 인증됨
- **근거**: DES-005 시나리오 2·3, CLI 명령어 전체 맵

**단계별 조작**

| # | 조작 | 기대 출력(화면 ID) | 판정 기준 |
|:---:|------|--------------------|----------|
| 1 | `cm project create --name "test-p1"` | SCR-P01 | 생성 성공 |
| 2 | `cm project list` | SCR-P02 | 목록에 표시 |
| 3 | `cm project status <id>` | SCR-P03 | 상세 6필드 + Agent 목록(빈 상태 포함) |
| 4 | `cm project status <id> --set running` | SCR-P04 | 상태 전이 성공 |
| 5 | `cm agent create --project <id> --name "a1" --type dev-sub --skill develop` | SCR-AG01 | 생성 성공 |
| 6 | `cm agent list --project <id>` | SCR-AG02 | 목록에 표시 |
| 7 | `cm agent status <agentId> --set running` | SCR-AG04 | 상태 전이 성공 |
| 8 | `cm task create --agent <agentId> --title "t1"` | SCR-T01 | 생성 성공 |
| 9 | `cm task list --agent <agentId>` | SCR-T02 | 목록에 표시 |
| 10 | `cm task status <taskId> --set in_progress` → `--set in_review` → `--set completed` | SCR-T04(3회) | `in_review` 경유 후 완료 |
| 11 | `cm status-changes --entity-type task --entity-id <taskId>` | SCR-SC01 | 4건 이력(ready→in_progress→in_review→completed) |
| 12 | `cm agent delete <agentId>` (PRM-02/03 확인 프롬프트에서 `y`) | SCR-AG02(삭제 후 목록) | 삭제 완료 + 하위 Task 처리 결과 표시 |

- **판정 기준(종합)**: 12단계 전부 성공, `--help` 옵션이 모든 명령에서 동작
- **예외 흐름**: `cm task status <id> --set completed`를 `in_progress`에서 직접 시도하면 `✗ 'in_progress' → 'completed' 전이는 허용되지 않습니다` — TC-UA-012 참조

---

### TC-UA-005: Must 19건 구현 및 단위 테스트 통과 확인

- **대응 완료 조건**: #2
- **목적**: PLN-002 Layer 1~6의 Must 19개 스토리가 전건 구현되고 단위 테스트가 통과하는지 확인한다
- **사전 조건**: TST-001(`docs/test-reports/cases/test-cases.md`) 작성 완료
- **근거**: TST-001, PLN-002 §작업 목록

**단계별 조작**

| # | 조작 | 기대 결과 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | 단위 테스트 스위트 실행(예: `npm test` — 실제 스크립트명은 develop 산출물 확인) | 전건 `PASS` | 실패(FAIL) 0건 |
| 2 | TST-001 §기존 단위 테스트 매핑 표에서 Must 19건 각각의 매핑 파일 확인 | 19건 전부 매핑 존재 | "미커버" 표시가 없거나, 있다면 사유가 §명세 공백에 등록됨 |
| 3 | TC-UA-001~004·006~011로 Must 19건의 대표 시나리오를 대표가 직접 조작 | 각 시나리오 판정 기준 통과 | 서면 테스트(단위)와 조작 테스트(UAT)가 모두 통과 |

- **판정 기준(종합)**: 단위 테스트 전건 통과 + TST-001 매핑표상 Must 19건 전건 매핑 확인 + 본 문서의 관련 시나리오 전건 통과
- **비고**: 이 시나리오는 "조작"보다 "확인" 성격이 강하다. TST-001 §커버리지 목표(Must 80%)는 AC 단위 추정치이므로, 실제 테스트 실행 결과(§1)가 최종 판정 근거다

---

### TC-UA-006: 서버 재시작 후 대화 보존 + Agent 삭제 시 archived 확인

- **대응 완료 조건**: #6
- **목적**: 대화 메시지가 서버 재시작 후에도 보존되고, Agent 삭제 시 대화가 삭제되지 않고 `archived`로 전환되며 이름이 보존되는지 확인한다
- **사전 조건**: Agent 1개 + 해당 CH-AGENT 채널에 메시지 2건 이상 존재
- **근거**: PLN-001 FR-027 AC1·AC2, DES-007 §5-1, DES-005 시나리오 5

**단계별 조작**

| # | 조작 | 기대 출력(화면 ID) | 판정 기준 |
|:---:|------|--------------------|----------|
| 1 | `cm chat agent <agentId>`에서 메시지 2건 확인 | 최근 메시지 목록(SCR-CH02) | 2건 표시 |
| 2 | `Ctrl+C`로 서버 정상 종료 | `[server] Server stopped` | 종료 로그 확인 |
| 3 | `npm run server:start` 재기동 | `Database: ./data/cm.db (existing)` | 정상 재기동 |
| 4 | `cm chat log <채널id>` | 동일 메시지 2건(SCR-CH12) | 재시작 전후 메시지 동일 |
| 5 | `cm agent delete <agentId>` (PRM-02 확인, `y`) | `✓ 삭제 완료`(SCR-AG02) | Agent 행 삭제, `archivedConversationId` 반환 |
| 6 | `cm chat list --status archived` | 채널 목록, 제목 뒤 `(삭제됨)` 표기(SCR-CH11) | 삭제된 Agent의 채널이 `archived` 상태로 조회됨, `entitySnapshot.agentName` 표시 |
| 7 | `cm chat log <채널id>` (삭제된 Agent의 채널) | 전체 메시지 + "종료된 채널입니다(읽기 전용)"(SCR-CH12) | 메시지가 삭제되지 않고 조회됨 |
| 8 | 같은 채널에서 새 메시지 전송 시도: `cm chat send <채널id> "테스트"` | `✗ CONVERSATION_ARCHIVED — "종료된 채널에는 보낼 수 없습니다"` | 발화 거부(409) |

- **판정 기준(종합)**: 1·4단계 메시지 동일성, 5·6단계 archived 전환 + 이름 보존, 7·8단계 조회 가능·발화 불가가 모두 성립
- **예외 흐름**: 8단계 자체가 "에러" 예외 흐름이다(읽기 전용 채널 발화 시도)

---

### TC-UA-007: `plan → analyze` 승인 게이트 차단 검증 (게이트 차단 예외 흐름)

- **대응 완료 조건**: #7
- **목적**: 승인 없이는 `plan → analyze` 전환이 절대 일어나지 않음을 확인한다
- **사전 조건**: Phase 1 부트스트랩 완료, `plan` 단계 `in_progress`
- **근거**: PLN-001 FR-030, DES-005 시나리오 7, DES-007 §7-1

**단계별 조작 — 정상 차단 경로**

| # | 조작 | 기대 출력(화면 ID) | 판정 기준 |
|:---:|------|--------------------|----------|
| 1 | `cm stage complete plan` | `✓ 완료 처리` + "다음 단계는 `cm stage start`로 착수하세요"(SCR-CH14) | `plan: completed` |
| 2 | `cm stage start analyze` (승인 없이 즉시 시도) | `✗ GATE_NOT_PASSED` + 필요한 승인 ID + `cm review <id>` 안내(SCR-CH09) | **403 GATE_NOT_PASSED — 차단 확인** |
| 3 | `cm progress` | 게이트 2곳 위치 + 통과 여부(SCR-CH06) | `plan→analyze` 게이트 `passed: false` |
| 4 | (승인 요청 존재 확인) `cm inbox` | `APV-GATE`·높음·"plan → analyze 전환"·잔여 `무기한`(SCR-CH04) | 승인 요청이 자동 생성되어 있음 |
| 5 | `cm review <승인id>` | 안건·산출물(PLN-001~005 Git 경로/Notion URL/동기화 상태)·근거·영향 범위(SCR-CH08) | 직전 단계 산출물 전체가 검토 대상으로 제시됨 |
| 6 | `cm decide <승인id> --approve` | `✓ 승인 완료` + `cm stage start analyze` 안내(SCR-CH05) | 승인됨. **단, `stages`는 아직 변경되지 않음**(승인≠착수) |
| 7 | `cm progress` | 게이트 `passed: true` | 게이트만 열림, `analyze`는 여전히 `pending` |
| 8 | `cm stage start analyze` | `✓ 단계 착수`(SCR-CH09) | `analyze: pending → in_progress` |

**예외 흐름 — 반려 및 재시도**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 9 | (2회차 시연용) 새 `APV-GATE` 발행 후 `cm decide <승인id> --reject` (사유 없이) | `✗ APPROVAL_REASON_REQUIRED` | 사유 없는 반려 거부 |
| 10 | `cm decide <승인id> --reject --reason "산출물 보완 필요"` | `✓ 반려 완료` + "Agent는 대기 상태를 유지합니다" | 단계는 `pending` 유지, Agent `waiting` 유지 |
| 11 | 반려 직후 `cm stage start analyze` 재시도 | `✗ GATE_NOT_PASSED` | 반려된 게이트로는 착수 불가(새 승인 필요) |

**예외 흐름 — WIP 위반으로 인한 차단**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 12 | 게이트가 필요 없는 전환에서(`design→develop` 등) 이미 다른 단계가 `in_progress`인 상태로 `cm stage start develop` 시도 | `✗ WIP_VIOLATION` + `cm progress --waive` 안내(EVT-CH09-4) | 409 WIP_VIOLATION |
| 13 | `cm progress --waive "설계 개정과 API 명세 병행"` | 면제 등록 | 이후 동일 위반이 재표시되지 않음 |
| 14 | `cm stage start develop` 재시도 | `✓ 단계 착수` | 면제 등록 후 착수 성공 |

- **판정 기준(종합)**: 2단계에서 반드시 차단되고, 승인(6) 이후에도 명시적 착수 명령(8) 전까지는 상태가 바뀌지 않는다. 반려(10) 시 대기가 유지되고, WIP 위반(12)도 별도로 차단된다

---

### TC-UA-008: 의사결정 등급 '높음' — 무기한 대기 검증

- **대응 완료 조건**: #8 (높음)
- **목적**: 등급 '높음' 의사결정 요청이 발행되면 대표가 응답하기 전까지 Agent가 무기한 대기하며, 시간이 지나도 자동 진행되지 않음을 확인한다
- **사전 조건**: Agent `running`
- **근거**: PLN-001 FR-028 AC1, DES-007 §3-1
- **비고(시뮬레이션 전제)**: Phase 1에서 등급 '높음' 요청은 Agent·Main 내부 로직이 발행한다(DES-002 §5 `POST /api/approvals`는 예외 상정용 공개 엔드포인트). 실제 에이전트 실행 없이 UAT를 진행할 경우 `POST /api/approvals {level:"high", approvalType:"APV-ARCH", ...}`로 동등한 상태를 재현한다

**단계별 조작**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | 등급 높음 승인 요청 발행(내부 트리거 또는 동등 API 호출) | Agent `waiting`, `waiting_reason: ceo_approval` | `cm agent status <id>`에서 확인 |
| 2 | `cm inbox` | `APV-*`·높음·경과시간·**잔여 `무기한`**(SCR-CH04) | `remainingSeconds: null` |
| 3 | 임의 시간 경과(수 시간 이상 시뮬레이션 또는 대기) 후 `cm inbox` 재조회 | 동일 건이 여전히 `pending`으로 표시 | 자동 진행되지 않음 — `ApprovalTimeoutJob`이 `high` 등급을 건드리지 않음 |
| 4 | `cm decide <id> --approve` | `✓ 승인 완료` + Agent 재개 안내 | Agent `waiting → running` |

- **판정 기준(종합)**: 3단계에서 시간 경과와 무관하게 상태 불변, 4단계에서만 재개

---

### TC-UA-009: 의사결정 등급 '보통' — 30분 자동 진행 검증 (타임아웃 예외 흐름)

- **대응 완료 조건**: #8 (보통)
- **목적**: 등급 '보통' 요청이 30분 경과 시 자동으로 진행되고 시스템 이벤트로 기록되는지 확인한다
- **사전 조건**: Agent `running`
- **근거**: PLN-001 FR-028 AC2, D-10
- **비고(시뮬레이션 전제)**: TC-UA-008과 동일하게 등급 `medium` 요청을 발행·재현한다. 실시간 30분 대기가 비현실적이므로, 실제 UAT 집행 시에는 서버 시각 조작 또는 `deadline_at`을 과거로 설정하는 테스트 전용 절차가 필요하다(§명세 공백 참조)

**단계별 조작**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | 등급 보통 승인 요청 발행 | Agent `waiting`, `waiting_reason: ceo_decision` | `cm agent status <id>`에서 확인 |
| 2 | `cm inbox` | 등급 보통·**잔여 시간 표시**(예: "29분 남음") | `remainingSeconds` 값 존재 |
| 3 | 30분 경과(또는 동등 시각 조작) | `cm inbox`에서 해당 건 사라짐, `cm approvals --resolved`에 `auto_advanced`로 표시 | Agent `waiting → running` |
| 4 | `cm chat agent <id>` | 시스템 이벤트(`MSG-05`, 접힌 라인)로 "타임아웃 자동 진행" 기록 | 대화에 자동 진행 사실이 남음 |

- **판정 기준(종합)**: 3단계에서 대표 조작 없이 자동 진행, 4단계에서 그 사실이 감사 가능하게 기록됨
- **타임아웃 예외 흐름**: 본 시나리오 전체가 "타임아웃" 예외 흐름에 해당한다

---

### TC-UA-010: 의사결정 등급 '낮음' — 대화 미노출 검증

- **대응 완료 조건**: #8 (낮음)
- **목적**: 등급 '낮음' 결정이 대화에 노출되지 않고 상태 변경 이력에만 남는지 확인한다
- **사전 조건**: Agent `running`
- **근거**: PLN-001 FR-028 AC3, CLAUDE.md 의사결정 등급 표("낮음 = 자율 판단, 결과만 기록")

**단계별 조작**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | `POST /api/approvals {level:"low", ...}` 직접 호출(경계 확인용) | `✗ 400 VALIDATION_ERROR` | 낮음 등급은 애초에 승인 객체로 적재되지 않음(low는 대화에 노출될 매체 자체가 생성되지 않음을 API 레벨에서 확인) |
| 2 | Agent가 낮음 등급 자율 판단을 수행(내부 동작, 예: 변수명 결정) | (대화에 아무 메시지도 생성되지 않음) | `cm chat agent <id>`에 해당 결정이 나타나지 않음 |
| 3 | `cm status-changes --entity-type agent --entity-id <id>` | 관련 상태 변경이 있다면 이력에 표시(자율 판단 자체가 상태 전이를 유발하지 않으면 이력 없음) | 대화에는 없고, 상태 이력 경로로만 확인 가능한 구조임을 확인 |

- **판정 기준(종합)**: 1단계에서 API가 low를 거부해 애초에 승인 큐에 들어갈 수 없음을 확인하고, 2단계에서 대화 미노출을 확인한다
- **명세 공백**: Phase 1 CLI/API에는 "낮음 등급 자율 판단"을 대표가 직접 트리거하거나 그 결과만 별도로 조회하는 전용 명령이 없다(행동 로그 FR-010은 Should이며 이번 Phase 1 구현 범위 밖). 따라서 2·3단계는 실제 Agent 실행 중 관찰로만 검증 가능하며, CLI만으로 독립 재현하는 방법은 근거 문서에 없다

---

### TC-UA-011: CLI 지휘 채널 명령 실행 확인 (`cm chat`, `cm inbox`, `cm decide`, `cm progress`)

- **대응 완료 조건**: #9
- **목적**: 4개 핵심 명령이 실제로 실행되고 올바른 화면을 출력하는지 확인한다
- **사전 조건**: 인증됨, Phase 1 부트스트랩 완료
- **근거**: PLN-001 INT-003, DES-006 §2 화면 인벤토리

**단계별 조작**

| # | 조작 | 기대 화면(화면 ID) | 판정 기준 |
|:---:|------|--------------------|----------|
| 1 | `cm chat main` | CH-MAIN 최근 메시지 + REPL 프롬프트(SCR-CH01) | 정상 진입, 메시지 0건이면 "무엇을 만들까요?" 안내 |
| 2 | `cm chat main`에서 요구사항 발화 → Main 응답 대기 | `[대표]` 전송 + `[Main]` 응답(SCR-CH01) | 왕복 확인 |
| 3 | `Ctrl+D` 또는 `/exit` | `✓ 세션 종료, 전송 n건` | REPL 정상 종료 |
| 4 | `cm inbox` | 미응답 목록(SCR-CH04) 또는 "대기 중인 의사결정이 없습니다" | 정상 실행(데이터 유무 무관) |
| 5 | `cm decide <id> --approve` (대기 건 있을 때) | `✓ 승인 완료`(SCR-CH05) | 정상 처리 |
| 6 | `cm decide <id>` (플래그 없이) | PRM-CH01 프롬프트: 안건 요약 + [승인/반려/취소] | 대화형 프롬프트 정상 표시 |
| 7 | `cm progress` | 7단계 보드 + 게이트 위치 + WIP 위반(SCR-CH06) | 정상 실행 |

- **판정 기준(종합)**: 7단계 전부 오류 없이 실행되고, 각 화면의 표시 데이터가 DES-006 §3-1 정의와 일치한다

---

### TC-UA-012: 예외 흐름 — 에러 처리 종합 검증

- **목적**: 중복·존재하지 않는 리소스·허용되지 않은 전이 등 일반 에러 처리가 CLI에서 사람이 읽을 수 있는 형태로 나타나는지 확인한다
- **사전 조건**: 인증됨
- **근거**: DES-006 §8 공통 에러, §4 인터랙션 명세 각 예외 이벤트

**단계별 조작**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | 이미 존재하는 이름으로 `cm project create --name "cm-v2"` | `✗ 이미 존재하는 프로젝트 이름입니다` + 입력값 에코 | EVT-P01-3 |
| 2 | 존재하지 않는 프로젝트 ID로 `cm project status <임의id>` | `✗ 프로젝트를 찾을 수 없습니다` + `cm project list` 안내 | EVT-P03-3 |
| 3 | `ready` 상태 프로젝트에 `cm project status <id> --set completed` | `✗ 전이 불가` + 허용된 전이 목록 | EVT-P04-2 |
| 4 | `cm project status <id> --set cancelled` (하위 Agent·Task 존재) | 상태 전이 + ⚠ 캐스케이드 경고(Agent n건·Task m건 각각의 이름과 전이) | EVT-P04-3 |
| 5 | `cm chat search "a"` (1자) | `✗ "검색어는 2자 이상이어야 합니다"` | EVT-CH13-2 |

- **판정 기준(종합)**: 5개 에러 상황 모두 CLI에서 원인과 복구 방법이 함께 출력된다(DES-006 §8 형식 준수)

---

### TC-UA-013: 예외 흐름 — 취소 검증

- **목적**: 파괴적 작업과 반려 흐름에서 "취소" 경로가 안전하게 동작하는지 확인한다
- **사전 조건**: Task를 가진 Agent 1개 존재, 처리 대기 승인 1건 존재
- **근거**: DES-006 §5 프롬프트 명세, §8 공통 규칙

**단계별 조작**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | `cm agent delete <id>` 실행 후 PRM-02 프롬프트에서 Enter(기본값) | "삭제가 취소되었습니다" | Agent·Task 미삭제 |
| 2 | `cm agent status <id>` 재조회 | 기존 상태 그대로 | 변경 없음 확인 |
| 3 | `cm decide <id>` (플래그 없이) → PRM-CH01에서 [취소] 선택 | 아무 처리도 되지 않음 | 승인 건 `pending` 유지 |
| 4 | `cm decide <id> --reject` (사유 미입력) | `✗ APPROVAL_REASON_REQUIRED` | 반려 자체가 거부되어 "취소"와 동일한 안전 효과 |

- **판정 기준(종합)**: 취소 경로에서 어떤 데이터도 변경되지 않는다(기본값이 항상 안전한 쪽)

---

### TC-UA-014: 예외 흐름 — WebSocket 연결 끊김과 재연결 시 메시지 보충

- **목적**: 실시간 연결이 끊긴 동안 발생한 메시지가 재연결 후 REST 조회로 보충되는지 확인한다(NFR-003)
- **사전 조건**: `cm chat agent <id>` REPL 세션 연결 중
- **근거**: PLN-001 NFR-003 AC2, DES-002 §2-4

**단계별 조작**

| # | 조작 | 기대 출력 | 판정 기준 |
|:---:|------|----------|----------|
| 1 | 서버와의 네트워크를 일시 차단(또는 서버 재시작) | `⚠ 재연결 중… (지수 백오프)` | EVT-CH01-6 |
| 2 | 차단 중 다른 경로로 메시지 1건 발생(예: 다른 터미널에서 `cm chat send`) | (REPL 화면에는 즉시 반영 안 됨) | 정상(끊긴 동안 미수신) |
| 3 | 네트워크 복구 | 재연결 완료 | WS 연결 상태가 "연결됨"으로 전환 |
| 4 | `cm chat log <채널id>` 또는 REPL 자동 보충 | 2단계에서 발생한 메시지가 나타남 | REST 조회로 누락분 보충(WS는 버퍼링하지 않음) |

- **판정 기준(종합)**: 4단계에서 누락 메시지가 정확히 보충된다. 3초 이내 전달(NFR-003 AC1) 자체의 정밀 측정은 TST-001 TC-PT-002(성능 테스트)로 별도 수행한다

---

## 명세 공백

| # | 항목 | 공백 내용 | 관련 시나리오 |
|---|------|----------|--------------|
| 1 | 등급 '높음'·'보통' 결정 요청의 CLI 트리거 명령 부재 | Phase 1 CLI 명령어 전체 맵(DES-005)에 대표가 직접 임의의 의사결정 요청을 생성하는 명령이 없다. `POST /api/approvals`는 API 레벨 예외 상정용으로만 문서화되어 있고 CLI 화면은 Phase 1에 추가되지 않는다(DES-002 §5 명시). 따라서 TC-UA-008·009는 실제 Agent 실행 또는 API 직접 호출로만 재현 가능하다 | TC-UA-008, TC-UA-009 |
| 2 | 30분 타임아웃의 UAT 재현 방법 미정의 | 실시간 30분 대기는 비현실적이나, 근거 문서 어디에도 테스트용 시각 조작·단축 절차가 정의되어 있지 않다. develop/test 단계에서 시각 모킹 또는 관리자 전용 단축 옵션을 마련해야 한다 | TC-UA-009 |
| 3 | '낮음' 등급 자율 판단의 독립 재현 방법 부재 | CLI/API 어디에도 "낮음 등급 결정"만 별도로 트리거하거나 조회하는 경로가 없다. 실제 Agent 실행 로그 관찰 외에는 UAT 재현 방법이 근거 문서에 없다 | TC-UA-010 |
| 4 | 마이그레이션 실패 시 UAT 재현 방법 부재 | TST-001 §명세 공백 3과 동일한 원인 — 실패 시나리오를 CLI로 유도하는 방법(예: 손상된 마이그레이션 파일 주입)이 문서화되어 있지 않다 | TC-UA-002 |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| **v1.1** | 2026-09-03 | **문서 정리 마감 — test 9단계 수정 루프 2차.** DES-006 표기를 33화면 → **34화면**으로 갱신(v3.5 기준). §목적과 범위에 **커버리지 공백 각주 신설** — 이번 루프 신설분(`PATCH /api/conversations/:id/read`·`POST /api/artifacts`·SCR-CH15)은 본 UAT가 다루지 않으며 단위·통합 테스트로 커버, UAT 보강은 다음 루프로 명시. 시나리오 본문·명세 공백 4건은 변경 없음 |
| v1 | 2026-09-03 | 최초 작성. PLN-002 §Phase 완료 조건 9개 항목 전건을 TC-UA-001~014로 시나리오화. 정상 흐름 + 예외 흐름(에러·취소·타임아웃·미인증·게이트 차단) 포함, 등급 3종 개별 시나리오화, 명세 공백 4건 등록 |
