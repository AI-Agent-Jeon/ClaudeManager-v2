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
  `StageService.complete()`(`in_progress → completed`)도 함께 구현했으나 DES-002 엔드포인트 목록에 대응 라우트가
  없어 서비스 메서드로만 존재한다 — HTTP로는 열지 않는다
- `PhaseRepository`에 stage 조회·전이 메서드 추가 — `findStageById()`·`findStagesByPhase()`(집계 없이 가벼운 조회,
  가드 1의 직전 단계 탐색용)·`findStageWithAggregates()`(단계 1건 집계, `findStagesWithAggregates`와 SQL을 공유하도록
  `stageAggregateSql()`로 추출)·`startStage()`·`completeStage()`·`updateCurrentStage()`

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

### Fixed

- **Agent 생성이 트랜잭션으로 묶이지 않던 문제** — Agent만 만들어지고 채널이 없으면 `cm chat agent <id>`가 실패한다. 롤백 테스트로 강제한다
- `status-changes` 라우트가 DB를 직접 쿼리하던 것을 Repository/Service 경유로 교정 (레이어 규칙 2)
- `DELETE /api/agents/:id`가 `closedApprovalCount`를 항상 0으로 반환하던 것을 실제 마감 건수로 교정 (R-04)
- **R-04 트랜잭션의 원자성이 주석에만 의존하던 문제** — `ApprovalService.closeByRequester()`·`AgentService.delete()`를 `db.transaction()` 안에서 `void`로 fire-and-forget 호출하던 구조는, 둘 다 `async`라 나중에 내부에 `await`가 하나 추가되면 그 뒤 쓰기가 커밋 이후로 밀려 원자성이 조용히 깨지고, 두 번째 호출이 거부되어도 `void`가 삼켜 unhandled rejection이 되며 트랜잭션은 그대로 커밋되는 위험이 있었다. `closeByRequesterSync()`·`deleteSync()` 동기 코어를 추출해 `DELETE /api/agents/:id`가 이를 트랜잭션 콜백 안에서 직접 호출·반환하도록 교정 — `async`가 아니므로 내부에 `await`를 쓰면 컴파일이 실패해, "트랜잭션 콜백 안에서 안전하다"는 불변조건을 타입 체커가 강제한다. 사전 조회(`countPendingByRequester`)·fire-and-forget이 모두 불필요해졌다. 두 실패 순서(승인 마감 후 Agent 삭제 실패 / 승인 마감 자체 실패) 모두 전건 롤백되는지 회귀 테스트로 검증
- **`AgentService.create()`에 남아 있던 같은 종류의 fire-and-forget 트랜잭션 호출** — `db.transaction()` 콜백 안에서 `async`인 `ConversationService.createForAgent()`를 `void`로 호출하던 것을, R-04와 같은 방식으로 `createForAgentSync()` 동기 코어를 추출해 직접 호출·`void` 제거로 교정. `db.transaction()` 콜백을 쓰는 나머지 지점(`PhaseService`·`ApprovalService`·`migrate.ts`)은 전수 확인 결과 전부 동기 Repository 호출만 있어 해당 없음

### Security

- `POST /api/conversations/:id/messages`가 `msgType`·`senderRole`을 서버에서 고정한다. `additionalProperties: false`가 없으면 클라이언트가 **대표 발화를 Agent 보고로 위장**할 수 있다
- `POST /api/approvals`가 `deadlineAt`을 요청 스키마에서 아예 받지 않는다 — 등급별 기한(`high`=무기한, `medium`=+30분)은 서버가 파생한다. `additionalProperties: false`가 클라이언트의 기한 지정을 차단한다
- `POST /api/approvals`가 `level='low'`를 스키마 enum에서 제외한다 — `low`는 적재하지 않으므로(R-06) HTTP로 직접 상정할 대상이 아니다
- `POST /api/approvals/:id/resolve`가 `status` enum에서 `auto_advanced`·`pending`을 제외한다 — 타임아웃 자동 진행은 스케줄러 전용
- 에러 응답에 내부 오류 원문을 노출하지 않는다 (SQLite 메시지에 파일 경로가 섞인다)
- Phase 1은 `127.0.0.1` 루프백 전용. 외부 노출은 Phase 2 터널링 이후

### 미반영 (Phase 1 잔여)

- WebSocket 엔드포인트 (`WS /ws`, `WS /ws/conversations/:id`) — Hub만 구현됨. `approval:created`·`approval:updated` 브로드캐스트 호출은 있으나 실제 소켓 라우트 배선은 다음 계층
- `ApprovalTimeoutJob`(60초 주기 스케줄러) — `ApprovalService.findExpired()`/`autoAdvance()`는 구현됐고 Job이 이를 호출하기만 하면 된다
- `PhaseService`/`StageService`(FR-029~031), 서버 기동 부트스트랩(R-01, CH-MAIN·Phase 1 시드) — 아직 없어 테스트가 `seedMainChannel` 픽스처로 채널을 직접 만든다
- 승인 상세의 `artifacts`가 `ArtifactService` 연동 전이라 코드 문자열을 최소 스텁(`ArtifactRef`)으로만 채운다 — 실제 제목·Notion/Git 경로·동기화 상태는 ArtifactService 도입 후 채워진다
- CLI (`cm approvals`, `cm decide` 등)
- FTS5 한국어 토크나이저 미확정 — `unicode61`은 조사가 붙은 어절을 원형으로 못 찾는다. `trigram`과 실데이터 비교 후 확정
- Graceful Shutdown이 단위 테스트 커버리지에서 제외됨 — 통합 테스트에서 다뤄야 한다
