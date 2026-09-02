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

### Changed

- 에러 응답에 **선택 필드 `details`** 추가. 필수는 4필드 그대로이며, 현재 사용처는 `INVALID_TRANSITION`의 `allowedTransitions` 하나뿐이다
- `EntitySnapshot`에 `projectId` 추가 — Agent 삭제 후에도 채널이 프로젝트 필터에 걸리도록
- `GET /api/conversations?project=` 필터가 `agents` 조인과 `entity_snapshot` 폴백을 함께 본다

### Fixed

- **Agent 생성이 트랜잭션으로 묶이지 않던 문제** — Agent만 만들어지고 채널이 없으면 `cm chat agent <id>`가 실패한다. 롤백 테스트로 강제한다
- `status-changes` 라우트가 DB를 직접 쿼리하던 것을 Repository/Service 경유로 교정 (레이어 규칙 2)

### Security

- `POST /api/conversations/:id/messages`가 `msgType`·`senderRole`을 서버에서 고정한다. `additionalProperties: false`가 없으면 클라이언트가 **대표 발화를 Agent 보고로 위장**할 수 있다
- 에러 응답에 내부 오류 원문을 노출하지 않는다 (SQLite 메시지에 파일 경로가 섞인다)
- Phase 1은 `127.0.0.1` 루프백 전용. 외부 노출은 Phase 2 터널링 이후

### 미반영 (Phase 1 잔여)

- WebSocket 엔드포인트 (`WS /ws`, `WS /ws/conversations/:id`) — Hub만 구현됨
- 승인·진행 (`FR-028`~`FR-031`), 부트스트랩, 타임아웃 잡, CLI
- FTS5 한국어 토크나이저 미확정 — `unicode61`은 조사가 붙은 어절을 원형으로 못 찾는다. `trigram`과 실데이터 비교 후 확정
- Graceful Shutdown이 단위 테스트 커버리지에서 제외됨 — 통합 테스트에서 다뤄야 한다
