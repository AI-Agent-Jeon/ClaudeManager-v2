# ANL-004 기술 스택 결정서

> Phase 1: 기반 구축
> 분석 기준 브랜치: main (commit d79f5c5)
> 작성일: 2026-08-23
> **원본**: [Notion ANL-004](https://app.notion.com/p/3c5d066504ec81d2837cc61941e44e08) · Git 동기화 2026-09-01
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

---

## 확정 사항 (이전 결정)

| 영역 | 기술 | 결정 시점 | 근거 |
|------|------|----------|------|
| 데이터베이스 | SQLite | plan | 1인 사용자, 로컬 실행, 파일 기반 간편 |
| API 통신 | REST + WebSocket | plan | REST=CRUD, WS=실시간(Phase 2) |
| 실행 환경 | MacBook 로컬 | plan | MVP 범위, 단일 사용자 |
| 배포 형태 | 웹앱(로컬 백엔드 + 웹 UI) + CLI | plan | Phase 1은 CLI, Phase 2에서 웹 UI |

---

## 신규 결정

### ADR-001: 백엔드 프레임워크

- **상태**: 제안 (자동 선택 — 평가 매트릭스 1위)
- **날짜**: 2026-08-23
- **결정자**: 자율 판단 (의사결정 등급: 보통)

**맥락**: Phase 1의 12개 Must 스토리는 REST API 서버를 필요로 한다. AI 에이전트가 코드를 생성하므로 프레임워크의 AI 코딩 호환성이 중요하다.

**후보**: Fastify, Express, Hono (모두 Node.js/TypeScript)

| 기준 (가중치) | Fastify | Express | Hono |
|--------------|:---:|:---:|:---:|
| 학습 곡선 (×2) | 4 | 5 | 4 |
| 생태계/플러그인 (×2) | 5 | 5 | 3 |
| 성능 (×1) | 4 | 3 | 5 |
| 커뮤니티 규모 (×1) | 4 | 5 | 3 |
| 프로젝트 적합성 (×3) | 5 | 4 | 4 |
| AI 코딩 호환성 (×2) | 5 | 5 | 4 |
| **가중 합계** | **51** | **50** | **42** |

**결정**: **Fastify (TypeScript)** — 스키마 기반 검증, 플러그인 아키텍처, Express 대비 2배 성능
**기각**: Express(스키마 검증 미내장), Hono(로컬 서버에 Edge 최적화 불필요)

---

### ADR-002: 프론트엔드 프레임워크

- **상태**: 제안 (Phase 2용이나 구조 결정 필요)
- **날짜**: 2026-08-23

**후보**: React (Vite), Vue (Vite), Svelte (SvelteKit)

| 기준 (가중치) | React | Vue | Svelte |
|--------------|:---:|:---:|:---:|
| 학습 곡선 (×2) | 4 | 5 | 5 |
| 생태계/플러그인 (×2) | 5 | 4 | 3 |
| 성능 (×1) | 3 | 4 | 5 |
| 커뮤니티 규모 (×1) | 5 | 3 | 2 |
| 프로젝트 적합성 (×3) | 4 | 4 | 4 |
| AI 코딩 호환성 (×2) | 5 | 4 | 3 |
| **가중 합계** | **48** | **45** | **41** |

**결정**: **React + Vite (TypeScript)** — AI 코딩 호환성 최고, 생태계 압도적

---

### ADR-003: CLI 프레임워크

- **상태**: 제안
- **날짜**: 2026-08-23

**후보**: Commander, Yargs, Oclif

| 기준 (가중치) | Commander | Yargs | Oclif |
|--------------|:---:|:---:|:---:|
| 학습 곡선 (×2) | 5 | 4 | 3 |
| 생태계/플러그인 (×2) | 4 | 4 | 3 |
| 성능 (×1) | 5 | 4 | 3 |
| 커뮤니티 규모 (×1) | 5 | 4 | 2 |
| 프로젝트 적합성 (×3) | 5 | 4 | 2 |
| AI 코딩 호환성 (×2) | 5 | 4 | 3 |
| **가중 합계** | **53** | **44** | **29** |

**결정**: **Commander** — 0 의존성, 22ms 시작, 프로젝트 규모에 최적

---

### ADR-004: Agent 프로세스 감지 방식 (Spike)

- **상태**: 제안 (spike 결론)
- **날짜**: 2026-08-23

**후보**: Claude Code Hooks, OS-level Polling, 수동 등록

**결정**: **Claude Code Hooks** 권장. Phase 1은 수동 등록(FR-007)으로 시작, FR-011 구현 시 Hooks 적용.

**근거**: 공식 지원 메커니즘, 이벤트 기반(실시간, 리소스 소모 없음), settings.json 설정만으로 동작.

---

## 보조 기술 결정

- **SQLite 드라이버**: better-sqlite3 — 동기식 API, node-sqlite3 대비 2~5배 성능
- **ORM**: Drizzle ORM — TypeScript-first, 스키마→타입 자동 추론, 마이그레이션 자동
- **빌드**: Vite(프론트엔드), tsx(개발), tsup(배포)

## 기술 스택 요약

| 영역 | 기술 | ADR | 상태 |
|------|------|-----|------|
| 언어 | TypeScript (Node.js) | — | 확정 |
| 백엔드 | Fastify 5 | ADR-001 | 제안 |
| 프론트엔드 | React + Vite | ADR-002 | 제안 |
| CLI | Commander | ADR-003 | 제안 |
| DB | SQLite (better-sqlite3) | (기확정) | 확정 |
| ORM | Drizzle ORM | — | 제안 |
| 통신 | REST + WebSocket | (기확정) | 확정 |
| Agent 감지 | Claude Code Hooks | ADR-004 | 제안 (spike) |

---

## ⚠ 2026-09-01 승인 반영 — 스택 추가 확정

`docs/00-approvals.md` 전건 승인으로 아래가 추가 확정되었다. **ADR로 정식 편입 필요.**

| 영역 | 기술 | 근거 결정 | ADR 신규 |
|------|------|----------|:---:|
| CSS 프레임워크 | **Tailwind CSS** | DES-010 기확정 | ADR-006 |
| UI 컴포넌트 | **shadcn/ui** | **D-03** — 코드 소유권 보유, Tailwind 정합, Resizable·Command·DataTable 모두 존재 | ADR-007 |
| 커맨드 팔레트 | **cmdk** | **D-04** | ADR-007에 포함 |
| 데이터 테이블 | **TanStack Table** | D-03 (shadcn/ui 기본 채택) | ADR-007에 포함 |
| 모바일 | **PWA** (별도 스택 없음, 웹과 동일 코드베이스) | **D-20** | ADR-008 |
| 푸시 | **Web Push (VAPID)** + `web-push` 서버 라이브러리 | **D-21** (APV-EXT 외부 연동) | ADR-009 |
| 생체인증 | **WebAuthn** (platform authenticator) | **D-22** | ADR-009에 포함 |
| 원격 접속 | **터널링** — Tailscale 또는 Cloudflare Tunnel (**고정 도메인 필수**) | **D-19** (APV-EXT 외부 연동) | ADR-010 |
| 전문 검색 | **SQLite FTS5** | **D-27** (대화 아카이브 검색) | ADR-011 |

> **미결**: D-19의 터널 제품 선택(Tailscale vs Cloudflare Tunnel)은 대표 실행 사항이다. WebAuthn 전제상 **고정 도메인을 제공하는 방식**이어야 한다.

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 — ADR-001~004, 평가 매트릭스 |
| — | 2026-09-01 | **Git 동기화** + 승인 반영 스택 추가(ADR-006~011 예정) 정리 |
