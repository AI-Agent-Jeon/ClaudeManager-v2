# CHANGELOG

Phase 1 — 기반 구축 (CLI + API · 대화 · 승인 게이트)

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따른다.

## [Unreleased] — Phase 1 개발 중

### Added

**기반 (Layer 0)**
- npm workspaces 3종 (`shared` · `backend` · `cli`), TypeScript 5.9 strict + NodeNext
- 공유 상수 — 상태 Enum 4종 · 대화 Enum 4종 · 승인 Enum 4종 · 진행 Enum 4종 · 에러 코드 25종 · WebSocket close code 3종
- 상태 전이 규칙 6종을 **데이터로** 정의 (`TRANSITION_MAP`)
- SQLite 연결 + 마이그레이션 러너 (`_migrations` 원장 기반 멱등 적용)
- 마이그레이션 7종 — `001_initial` · `002_conversations` · `003_phases` · `004_approvals` · `005_artifacts` · `006_status_ext` · `007_conversation_read`
- FTS5 전문 검색 (`messages_fts`, external content + 트리거 3종)

**서버 (Layer 1)**
- Fastify 5 앱 + 기동 순서 4단계 (설정 → DB → 마이그레이션 → 플러그인·라우트)
- Graceful Shutdown — SIGTERM/SIGINT, WS 소켓 정리(1001) → DB 종료 순서, 10초 타임아웃
- JWT 인증 (`FR-002`) — 만료와 무효를 구분해 응답
- 인증 미들웨어 (`NFR-002`) — 보호된 라우트에 `onRequest` 훅
- WebSocket Hub (`NFR-003`) — 채널별 브로드캐스트, 출력 전용, 버퍼링 없음

**도메인 (Layer 2)**
- 상태 변경 이력 조회 (`FR-009`)
- 프로젝트 CRUD + 상태 전이 (`FR-003`~`FR-006`)
- 대화 채널·메시지·전문 검색·마크다운 내보내기 (`FR-026` · `FR-027`)
- 미읽음 수 — 채널당 읽음 포인터 기반
- Agent CRUD + 채널 생명주기 연동 (`FR-007`)
- Task CRUD + 상태 전이 (`FR-008`)
- 캐스케이드 — Project → Agent → Task (취소·일시정지)
- 승인 요청·응답 (`FR-028` · `FR-030`) — `ApprovalService.request()`(low/high/medium 3분기, R-06) ·
  `resolve()`(승인·반려·조건부, 검증 순서가 DES-002 §5와 1:1) · `findGateApproval()`(단계 게이트 조회용) ·
  `findExpired()`/`autoAdvance()`(ApprovalTimeoutJob이 호출할 진입점, GATE는 이중 방어로 자동 진행 거부) ·
  `closeByRequester()`(Agent 삭제 시 미처리 승인 일괄 마감, R-04)
- `POST /api/approvals` · `GET /api/approvals` · `GET /api/approvals/:id` · `POST /api/approvals/:id/resolve` (R-07)
- `DELETE /api/agents/:id`가 승인 마감과 Agent 삭제를 `db.transaction()`으로 조율해 실제 `closedApprovalCount`를 반환 (R-04)
- `AgentService.updateStatus()`에 `waitingReason` 3번째 인자 추가 — 승인 요청 시 사유(`ceo_approval`/`ceo_decision`)를 함께 전이
- Phase 진행 추적·WIP (`FR-029`) — `PhaseService.create()`(Phase + 7단계를 한 트랜잭션으로 생성, `number` 중복/`<1` 검증) ·
  `ensurePhase()`(부트스트랩 전용 멱등 생성, R-01이 이후 계층에서 호출) · `getCurrent()`(진행 중 Phase 없으면 404) ·
  `checkWip()`(저장하지 않고 조회 시점 계산, 면제가 있어도 위반은 계속 보고) · `createWaiver()`(사유 빈 문자열·공백 모두 거부)
- `GET /api/phases/current` · `POST /api/phases` · `POST /api/wip-waivers` — `artifactCount`·`pendingApprovalCount`·`gate`는
  `PhaseRepository`가 JOIN(윈도 함수로 단계별 최신 APV-GATE 승인만 선택)으로 한 쿼리에 집계해 N+1을 피한다.
  `gate.required`는 저장하지 않고 CLAUDE.md 스킬 전환 모드에서 파생(`plan`·`test` 단계만 true, DES-002 §5 예시 근거)
- 단계 착수 3단 게이트 강제 (`FR-030`) — `StageService.start()`가 **CLAUDE.md 스킬 전환 게이트의 유일한 강제 지점**인
  `POST /api/stages/:id/start`를 구현한다. 가드 순서 고정: ①직전 단계가 `completed`인가(`422 INVALID_TRANSITION`,
  자기 자신의 전이 유효성도 `STAGE_TRANSITIONS`로 함께 검증 — 재착수·재완료 우회 차단) ②게이트 필요 단계면
  `ApprovalService.findGateApproval()`로 조회한 `APV-GATE`가 `approved`인가(`403 GATE_NOT_PASSED`,
  `StageService → ApprovalService`는 허용된 Service 간 의존 4건 중 하나 — `ApprovalRepository`는 직접 만지지 않는다)
  ③WIP=1 위반인데 `wip_waivers` 면제가 없는가(`409 WIP_VIOLATION`). 성공 시 `stages.status='in_progress'`·`started_at`·
  `phases.current_stage`·`status_changes`를 한 트랜잭션으로 갱신하고, 커밋 후 `stage:changed`를 브로드캐스트한다.
  `StageService.complete()`(`in_progress → completed`)도 함께 구현했다 — 대응 라우트는 Layer 2-8 보완(아래)에서 연다
- `PhaseRepository`에 stage 조회·전이 메서드 추가 — `findStageById()`·`findStagesByPhase()`(집계 없이 가벼운 조회,
  가드 1의 직전 단계 탐색용)·`findStageWithAggregates()`(단계 1건 집계, `findStagesWithAggregates`와 SQL을 공유하도록
  `stageAggregateSql()`로 추출)·`startStage()`·`completeStage()`·`updateCurrentStage()`
- **Layer 2-8 보완 — `POST /api/stages/:id/complete` 라우트 신설** (대표 승인 A안). `StageService.complete()`는
  Layer 2-8에서 이미 구현됐지만 대응 HTTP 엔드포인트가 없었다 — DES-002 §3-3 엔드포인트 목록에 `complete`가
  빠져 있던 설계 누락으로, `start`의 가드 1("직전 단계가 `completed`인가")을 만족시킬 방법이 없어 `plan` 착수
  이후 어떤 후속 단계도 영원히 착수할 수 없는 플로우 단절이 있었다. `start` 라우트와 같은 모양으로
  `POST /api/stages/:id/complete`를 추가: 성공 시 `200`+`StageSummary`(`status='completed'`·`completed_at` 기록),
  대상 없음 `404 STAGE_NOT_FOUND`, `in_progress`가 아니면 `422 INVALID_TRANSITION`. `phases.current_stage`는
  바꾸지 않는다(다음 `start`가 갱신). 선행 조건(산출물 개수·승인 상태)은 검사하지 않는다 — 검사를 걸면
  게이트 강제 지점이 `start` 하나가 아니게 되어 R-03("게이트 강제는 start 한 곳에서만")이 흐려진다.
  본문 없이 호출 가능하되 `preValidation`으로 `undefined` 본문을 `{}`로 정규화한 뒤 `additionalProperties: false`
  스키마를 통과시켜, 본문을 보내지 않은 요청은 통과시키고 알 수 없는 필드가 있는 본문은 거부한다.
  플로우 회귀 테스트로 `plan` 착수 → 완료 → `analyze` 착수가 실제로 성공하는지 고정
- **산출물 동기화 추적 (`FR-031`, Layer 2-9 — Layer 2의 마지막 계층)** — `ArtifactService.list()`(`stage`·`syncStatus`
  필터, SQL WHERE에서 직접 구성해 전건 메모리 필터링을 하지 않는다) · `getById()` · `getContent()`(본문 조회) ·
  `upsert()`(`code` UNIQUE 기준 신규 생성/기존 갱신, `status`는 대상 밖이라 승인 흐름이 관리하는 값을 되돌리지
  않는다) · 모듈 스코프 순수 함수 `deriveSyncStatus()`(저장하지 않고 `notionUrl`·`gitPath` 유무에서 파생,
  DES-003 §4-4 4분기 — `notion_only`와 `missing`의 구분이 2026-09-01 "analyze 건너뜀" 오진단의 재발 방지선이라
  전건을 명시적으로 테스트로 고정했다). 빈 문자열도 "없음"으로 취급(`ArtifactRepository`의 SQL 조건과 기준을
  통일 — 갈리면 목록 필터와 상세 조회의 syncStatus가 서로 다른 값을 보이는 모순이 생긴다)
- `GET /api/artifacts`(`stage`·`syncStatus` 쿼리 필터) · `GET /api/artifacts/:id/content`(검토 패널 본문 조회) — 후자는
  `git_path`를 저장소 루트 기준으로 정규화하고 절대 경로·상위 디렉터리 탈출을 거부한다(§4 보안 방어, 아래 Security
  참조). 성공·`gitPath=null`·존재하지 않는 산출물·존재하지 않는 파일·탈출 시도를 모두 회귀 테스트로 고정
- `ArtifactRepository` — `findById()`·`findByCode()`·`findByCodes()`(코드 배열 일괄 조회, 빈 배열은 쿼리 없이 빈
  배열)·`findMany()`(`syncStatus` 4분기를 SQL `WHERE` 조건으로 번역하는 `SYNC_STATUS_CLAUSE`)·`upsert()`(`ON
  CONFLICT(code) DO UPDATE`, `status`는 SET 절에 없어 갱신 시 유지된다)
- **서버 기동 부트스트랩 (`FR-026`·`FR-029`, Layer R-1)** — `BootstrapService.seed()`가 CH-MAIN 채널·Phase 1(`기반
  구축`)·7단계를 멱등 시드한다(전부 `ConversationService.ensureMainChannel()`·`PhaseService.ensurePhase()` 경유,
  Repository 직접 접근 없음 — 레이어 규칙 7). 순서 고정 — `conversations` → `phases`(+`stages`, `stages.phase_id`가
  `phases`를 참조). 셋 다 `ON CONFLICT DO NOTHING` 계열이라 매 기동마다 실행해도 안전하다. `server.ts`가 마이그레이션
  이후·`ApprovalTimeoutJob.start()`·`listen()` 이전에 호출하고, 실패하면 예외가 `main().catch()`까지 그대로 전파돼
  listen 없이 기동을 중단한다. `buildApp()` 자체는 시드를 호출하지 않는다 — 각 라우트 테스트가 이미 `POST
  /api/phases`·`seedMainChannel` 픽스처로 직접 상태를 구성하므로, 모든 테스트에서 자동 시드되면 "Phase 없음 →
  404" 같은 기존 회귀가 깨진다. 연속 3회 호출해도 CH-MAIN 1행·Phase 1행·stages 7행만 남는 멱등성 테스트가 핵심 방어선
- **타임아웃 자동 진행 스케줄러 (`D-10`, Layer R-2)** — `ApprovalTimeoutJob`이 ADR-012로 확정된 대로 Fastify 프로세스
  내부 `setInterval`(60초, `APPROVAL_JOB_INTERVAL_MS`)로 `ApprovalService.findExpired()`→`autoAdvance()`를 호출한다.
  이전 tick이 끝나지 않았으면 새 tick을 건너뛰고(`ticking` 플래그), 만료 건 하나가 실패해도(`APV-GATE` 이중 방어 ②
  포함) 로깅 후 다음 건으로 진행하며, `findExpired()` 자체가 실패해도 tick 예외를 삼켜 서버를 죽이지 않는다. `high`는
  `deadline_at`이 NULL이라 조회 조건에서 자동 제외되고, `APV-GATE`는 그 조건과 별개로 DB CHECK 제약(마이그레이션 004
  `NOT (level='high' AND deadline_at IS NOT NULL)`·`NOT (approval_type='APV-GATE' AND level<>'high')`)이 애초에
  `deadline_at` 있는 GATE 행 생성 자체를 막는다 — 조회 조건·잡 내부 유형 재검사·DB 스키마까지 3단 방어. `server.ts`가
  `BootstrapService.seed()` 완료 후 `start()`, Graceful Shutdown에서 가장 먼저 `stop()`을 호출한다(DB 종료보다 먼저
  멈춰야 tick이 닫힌 연결에 쓰지 않는다)

**CLI (Layer 3-1)** — `src/cli/` 골격 + `cm auth` 수직 슬라이스
- `ApiClient`(`src/cli/api-client.ts`) — undici 래퍼. Base URL 기본값 `http://127.0.0.1:3000/api`
  (`CM_HOST`·`CM_PORT`로 재정의 — 백엔드(`src/backend/config.ts`)와 같은 환경 변수를 재사용해
  "서버는 다른 포트, CLI는 기본 포트" 불일치를 막는다). 서버 에러 응답의 `code`·선택 필드 `details`
  (DEV-D-04)를 보존해 `ApiRequestError`로 던지고, `ECONNREFUSED`는 스택 트레이스 대신
  `ServerUnreachableError`로 구분해 "서버가 실행 중이 아닙니다" 수준의 안내를 낼 수 있게 한다.
  `dispatcher` 옵션으로 undici `MockAgent`를 주입할 수 있어 실제 소켓 없이 테스트한다
- `CLI 설정`(`src/cli/config.ts`) — 토큰을 `~/.claude-manager/config.json`에 저장(`0o600`, Windows는
  모드 비트 무시). 파일 없음·손상된 JSON·필드 누락을 전부 "미인증"과 동일하게 취급해 예외 없이 `null`을
  돌려준다 — 재로그인으로 자연 복구
- `cm auth login/logout/status`(`src/cli/commands/auth.ts`, DES-006 SCR-A01~A03) — 판정 로직(`run*`)과
  Commander 연결을 분리했다. 로그인 시크릿은 `readline`을 마스킹 입력으로 재정의해 받고
  (`--force`로 생략 불가, PRM-01), 비대화형 환경(파이프·CI)에서는 즉시 중단한다. 결과 판별 유니온에
  **토큰 원문을 담지 않는다** — 저장 경로·만료일시만 담아 로그·에러 메시지에 토큰이 찍히지 않게 한다
  (요구사항 명시 검증 항목). `cm auth status`는 서버 unreachable이어도 로컬에 유효한 토큰이 있으면
  경고블록으로만 알리고 실패로 취급하지 않는다(EVT-A03-4)
- `cm`(`src/cli/index.ts`) — Commander 진입점. `--help` 동작, 성공 0/실패 비0 종료 코드. 다른 명령
  그룹(`project`·`agent`·`task`·`chat`·`approval`·`progress`)은 Layer 3-2에서 그룹별로 추가한다

**CLI (Layer 3-2 그룹 A)** — `cm project/agent/task/status-changes` 기본 CRUD 14개 명령
- `src/cli/output.ts` — 목록 3종(`project`·`agent`·`task`)·`status-changes`가 공유하는 표·박스·페이지
  푸터 헬퍼(`renderTable`·`formatFields`·`paginationFooter`·`shortId`·`truncateName`·`formatTimestamp`
  등). `auth.ts`엔 목록 화면이 없어 이 그룹이 최초로 굳힌 관용구다(DES-006 §8 출력 형식·ID 축약 규칙·
  출력 컬럼 규칙을 그대로 구현) — 세 목록이 서로 다른 표 렌더링을 만들지 않게 이 헬퍼 하나만 거친다
- `src/cli/runtime.ts` — 14개 명령이 공유하는 실행 골격. `checkAuth`(로컬 토큰으로 "토큰 없음"·"만료"를
  서버 왕복 없이 즉시 판정) · `resolveId`(§8 "명령어 인자: 앞 8자리 허용" — 백엔드 `findById`는 정확히
  일치하는 UUID만 찾으므로 8자 접두어를 목록 조회로 직접 전체 UUID로 확장하고, 접두어 충돌은 후보 목록 +
  "더 긴 ID를 입력하세요"로 응답) · `diffCascade`/`cascadeBlock`(PATCH 응답엔 캐스케이드 정보가 없어
  전이 전후 스냅샷을 비교해 SCR-P04·AG04의 "캐스케이드 대상 전체 목록"을 도출) · `defaultPromptConfirm`
  (`cm agent delete`의 y/N 확인, `auth.ts`의 `defaultPromptSecret`과 같은 NOT_TTY 가드 원칙)
- `cm project create/list/status`(`src/cli/commands/project.ts`, DES-006 SCR-P01~P04) — 상세 조회의
  "허용 상태 전이 목록"은 API 응답에 없는 필드라 `shared/state-transitions.ts`(백엔드 `state-machine.ts`와
  공유하는 단일 원본)를 직접 조회해 도출한다. `--set cancelled`는 전이 전후 프로젝트 상세를 비교해
  캐스케이드된 Agent 목록(이름+ID+전이)을 함께 보여준다
- `cm agent create/list/status/delete`(`src/cli/commands/agent.ts`, DES-006 SCR-AG01~AG05) — 생성
  결과의 "소속 프로젝트(이름+ID)"를 위해 성공 후 프로젝트를 한 번 더 조회한다. `--set`이
  `PARENT_NOT_ACTIVE`로 실패하면(상위 프로젝트 비활성) 프로젝트명·현재상태를 별도 조회해 채운다(에러
  응답엔 상태 텍스트만 있고 이름이 없다). `delete`는 PRM-02(Task 존재)·PRM-03(Task 없음) 확인 프롬프트를
  거치고(`--force`로 생략 가능, 비대화형이면 즉시 중단), 삭제 결과에 **보관된 대화 ID(D-27)**·**마감된
  승인 건수(R-04)**를 함께 출력한다 — 삭제가 무엇을 남기고 무엇을 닫았는지 보여준다
- `cm task create/list/status`(`src/cli/commands/task.ts`, DES-006 SCR-T01~T04) — Task는 하위
  엔티티가 없어 캐스케이드·삭제 명령이 없다. 나머지는 `project.ts`·`agent.ts`와 같은 패턴
- `cm status-changes`(`src/cli/commands/status-changes.ts`, DES-006 SCR-SC01) — `--entity-id` 필터가
  없을 때만 ID 컬럼을 추가한다(EVT-SC01-2). `--entity-id`는 project·agent·task 세 테이블에 걸친 값이라
  어느 목록에서 접두어를 확장해야 할지 알 수 없어 전체 UUID를 그대로 받는다(자율 판단, 등급 낮음)
- **`--project`·`--agent` 참조 옵션도 §8 ID 축약 규칙 대상** — `cm agent create --project`·
  `cm task create --agent`·`cm agent list --project`·`cm task list --agent`가 받는 ID를 전부
  `resolveId()`로 접두어 해석한다. 최초 구현은 상세/상태변경/삭제의 `<id>` 인자만 해석하고 이 네
  옵션은 그대로 API에 넘겨, 8자 접두어를 넣으면(목록 화면이 보여주는 그대로) 항상 `PROJECT_NOT_FOUND`/
  `AGENT_NOT_FOUND`이거나 목록 필터가 조용히 0건이 되는 문제가 있었다 — 실제 백엔드를 띄워 14개 명령을
  손으로 돌리는 과정(개발 지시 §6 항목 5)에서 발견해 교정

### Changed

- **`GATE_REQUIRED_SKILLS`를 단일 원본으로 승격** — `phase.service.ts`의 모듈 지역 상수였던 것을
  `shared/constants.ts`로 옮기고, `StageService.isGateRequired()`(착수 가드 2단)가 같은 배열을 참조하게 했다.
  두 서비스가 각자 배열을 들고 있으면 어느 stage의 `approvals.stage_id`에 `APV-GATE`를 채워야 하는지가 갈리고,
  승인은 났는데 게이트가 안 열리는(또는 그 반대의) 상태가 될 수 있었다. 7개 스킬 전건 대조 회귀 테스트로 고정
- `WIP_RULE`("주요 단계 WIP = 1")도 같은 이유로 `shared/constants.ts`로 승격 — `PhaseService.checkWip()`과
  `StageService.start()` 가드 3단이 다른 문자열을 쓰면 같은 `wip_waivers` 면제를 두고도 판정이 갈릴 수 있었다
- `gate.required` 파생·`StageAggregateRow → StageSummary` 변환(`isGateRequired`·`toStageSummary`·`sortBySkillOrder`·
  `STAGE_ORDER`)을 `phase.service.ts` 내부에서 신설 `stage.service.ts`의 `stage-mapper.ts`로 승격해 `PhaseService`·
  `StageService`가 공유한다 (§2 매핑 공유를 위한 최소 리팩터링, 개발 지시 범위)
- 에러 응답에 **선택 필드 `details`** 추가. 필수는 4필드 그대로이며, 현재 사용처는 `INVALID_TRANSITION`의 `allowedTransitions` 하나뿐이다
- `EntitySnapshot`에 `projectId` 추가 — Agent 삭제 후에도 채널이 프로젝트 필터에 걸리도록
- `GET /api/conversations?project=` 필터가 `agents` 조인과 `entity_snapshot` 폴백을 함께 본다
- `AgentRepository.updateStatus()`가 `waiting_reason`을 항상 NULL로 밀어넣던 것을 고쳐, 호출자가 넘긴 값을 쓰되 `status≠'waiting'`이면 NULL을 강제한다 (DB CHECK와 동일 규칙을 애플리케이션에서도 지킨다)
- `AgentService.delete()`가 `ConversationService.archiveByEntity()`(await)를 거치지 않고 `ConversationRepository`를 직접 써서 대화를 아카이브한다 — `DELETE /api/agents/:id`가 승인 마감과 한 `db.transaction()` 안에서 이 메서드를 fire-and-forget으로 호출하므로, 내부에 실제 `await` 지점이 있으면 그 뒤 쓰기가 트랜잭션 밖으로 밀린다
- **`ApprovalService`의 `toArtifactStub()` 제거 — 2-6이 남긴 스텁을 실제 조회로 교체 (Layer 2-9 §3)**. `ApprovalDetail.artifacts`가
  이제 `artifacts` 테이블의 실제 `title`·`notionUrl`·`gitPath`·`syncStatus`로 채워진다 — 이전에는 코드 문자열만으로
  `{ title: code, syncStatus: 'missing' }` 스텁을 만들어, DES-014 검토 패널이 산출물 상태를 전부 `missing`으로
  보여주는 상태였다(2026-09-01 오진단을 시스템이 스스로 재현하는 상태였다). `ApprovalService`가 `ArtifactRepository`를
  직접 주입받는다 — `ApprovalService → ArtifactService`는 "허용된 Service 간 의존 4건"에 없어, `PhaseService`가
  집계를 위해 Repository를 직접 읽은 선례(Layer 2-7)를 따라 읽기 전용 조회는 Service 계층을 거치지 않는다.
  `approvals.artifacts`의 코드가 `artifacts` 테이블에 없으면 조회 실패로 승인 상세 전체가 깨지지 않도록
  `syncStatus='missing'` 표시값으로 채운다(`request()`·`resolve()`·`autoAdvance()`·`getById()`·`findGateApproval()`
  전 경로에 적용, 회귀 테스트로 스텁이 사라졌는지·존재하지 않는 코드가 섞여도 안전한지 고정)

### Fixed

- **Agent 생성이 트랜잭션으로 묶이지 않던 문제** — Agent만 만들어지고 채널이 없으면 `cm chat agent <id>`가 실패한다. 롤백 테스트로 강제한다
- `status-changes` 라우트가 DB를 직접 쿼리하던 것을 Repository/Service 경유로 교정 (레이어 규칙 2)
- `DELETE /api/agents/:id`가 `closedApprovalCount`를 항상 0으로 반환하던 것을 실제 마감 건수로 교정 (R-04)
- **R-04 트랜잭션의 원자성이 주석에만 의존하던 문제** — `ApprovalService.closeByRequester()`·`AgentService.delete()`를 `db.transaction()` 안에서 `void`로 fire-and-forget 호출하던 구조는, 둘 다 `async`라 나중에 내부에 `await`가 하나 추가되면 그 뒤 쓰기가 커밋 이후로 밀려 원자성이 조용히 깨지고, 두 번째 호출이 거부되어도 `void`가 삼켜 unhandled rejection이 되며 트랜잭션은 그대로 커밋되는 위험이 있었다. `closeByRequesterSync()`·`deleteSync()` 동기 코어를 추출해 `DELETE /api/agents/:id`가 이를 트랜잭션 콜백 안에서 직접 호출·반환하도록 교정 — `async`가 아니므로 내부에 `await`를 쓰면 컴파일이 실패해, "트랜잭션 콜백 안에서 안전하다"는 불변조건을 타입 체커가 강제한다. 사전 조회(`countPendingByRequester`)·fire-and-forget이 모두 불필요해졌다. 두 실패 순서(승인 마감 후 Agent 삭제 실패 / 승인 마감 자체 실패) 모두 전건 롤백되는지 회귀 테스트로 검증
- **`AgentService.create()`에 남아 있던 같은 종류의 fire-and-forget 트랜잭션 호출** — `db.transaction()` 콜백 안에서 `async`인 `ConversationService.createForAgent()`를 `void`로 호출하던 것을, R-04와 같은 방식으로 `createForAgentSync()` 동기 코어를 추출해 직접 호출·`void` 제거로 교정. `db.transaction()` 콜백을 쓰는 나머지 지점(`PhaseService`·`ApprovalService`·`migrate.ts`)은 전수 확인 결과 전부 동기 Repository 호출만 있어 해당 없음
- **`cm project status --set`·`cm agent status --set`이 캐스케이드 대상이 아닐 때 "이전상태"를 빈 문자열로 보여주던 문제** — `--set cancelled`일 때만 전이 전 스냅샷을 조회하도록 짜여 있어, 그 외 모든 전이(예: `ready → running`)가 `전이:  → running`처럼 출력됐다. 전이 전 상태 조회를 캐스케이드 여부와 무관하게 항상 수행하도록 교정 — 실제 백엔드로 14개 명령을 손으로 돌리다 발견했다(개발 지시 §6 항목 5)

### Security

- `POST /api/conversations/:id/messages`가 `msgType`·`senderRole`을 서버에서 고정한다. `additionalProperties: false`가 없으면 클라이언트가 **대표 발화를 Agent 보고로 위장**할 수 있다
- `POST /api/approvals`가 `deadlineAt`을 요청 스키마에서 아예 받지 않는다 — 등급별 기한(`high`=무기한, `medium`=+30분)은 서버가 파생한다. `additionalProperties: false`가 클라이언트의 기한 지정을 차단한다
- `POST /api/approvals`가 `level='low'`를 스키마 enum에서 제외한다 — `low`는 적재하지 않으므로(R-06) HTTP로 직접 상정할 대상이 아니다
- `POST /api/approvals/:id/resolve`가 `status` enum에서 `auto_advanced`·`pending`을 제외한다 — 타임아웃 자동 진행은 스케줄러 전용
- 에러 응답에 내부 오류 원문을 노출하지 않는다 (SQLite 메시지에 파일 경로가 섞인다)
- Phase 1은 `127.0.0.1` 루프백 전용. 외부 노출은 Phase 2 터널링 이후
- `GET /api/artifacts/:id/content`가 `git_path`를 저장소 루트 기준 절대 경로로 정규화한 뒤 저장소 루트 밖을
  가리키면 읽지 않는다 — 절대 경로 입력·`..` 상위 디렉터리 탈출·URL 인코딩된 탈출 시도(`..%2F`)를 전부 거부한다.
  경로 주입 시도·존재하지 않는 파일·연결된 Git 경로 없음을 모두 동일한 `404 NOT_FOUND`로 응답해 클라이언트에
  구분을 노출하지 않고, 에러 메시지에 파일 시스템 경로·OS 에러 원문(`ENOENT` 등)을 담지 않는다. 본문 읽기 크기
  상한(2MB, 등급 낮음 자율 판단)을 두어 잘못 연결된 대용량 파일을 통째로 메모리에 올리지 않는다

### 미반영 (Phase 1 잔여)

- WebSocket 엔드포인트 (`WS /ws`, `WS /ws/conversations/:id`) — Hub만 구현됨. `approval:created`·`approval:updated` 브로드캐스트 호출은 있으나 실제 소켓 라우트 배선은 다음 계층
- CLI 명령 그룹 — `cm chat`·`cm inbox`·`cm decide`·`cm approvals`·`cm review`·`cm progress`·`cm stage`·`cm artifacts` (`cm auth`는 Layer 3-1, `cm project`·`cm agent`·`cm task`·`cm status-changes`는 Layer 3-2 그룹 A에서 구현됨. 그룹 B·C·D 잔여)
- FTS5 한국어 토크나이저 미확정 — `unicode61`은 조사가 붙은 어절을 원형으로 못 찾는다. `trigram`과 실데이터 비교 후 확정
- Graceful Shutdown이 단위 테스트 커버리지에서 제외됨 — 통합 테스트에서 다뤄야 한다
