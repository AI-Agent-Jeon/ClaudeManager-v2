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

### Changed

- 에러 응답에 **선택 필드 `details`** 추가. 필수는 4필드 그대로이며, 현재 사용처는 `INVALID_TRANSITION`의 `allowedTransitions` 하나뿐이다
- `EntitySnapshot`에 `projectId` 추가 — Agent 삭제 후에도 채널이 프로젝트 필터에 걸리도록
- `GET /api/conversations?project=` 필터가 `agents` 조인과 `entity_snapshot` 폴백을 함께 본다
- `AgentRepository.updateStatus()`가 `waiting_reason`을 항상 NULL로 밀어넣던 것을 고쳐, 호출자가 넘긴 값을 쓰되 `status≠'waiting'`이면 NULL을 강제한다 (DB CHECK와 동일 규칙을 애플리케이션에서도 지킨다)
- `AgentService.delete()`가 `ConversationService.archiveByEntity()`(await)를 거치지 않고 `ConversationRepository`를 직접 써서 대화를 아카이브한다 — `DELETE /api/agents/:id`가 승인 마감과 한 `db.transaction()` 안에서 이 메서드를 fire-and-forget으로 호출하므로, 내부에 실제 `await` 지점이 있으면 그 뒤 쓰기가 트랜잭션 밖으로 밀린다

### Fixed

- **Agent 생성이 트랜잭션으로 묶이지 않던 문제** — Agent만 만들어지고 채널이 없으면 `cm chat agent <id>`가 실패한다. 롤백 테스트로 강제한다
- `status-changes` 라우트가 DB를 직접 쿼리하던 것을 Repository/Service 경유로 교정 (레이어 규칙 2)
- `DELETE /api/agents/:id`가 `closedApprovalCount`를 항상 0으로 반환하던 것을 실제 마감 건수로 교정 (R-04)

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
