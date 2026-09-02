# 소스코드 규칙

## 기술 스택 (확정 — ANL-004 v2)

| 영역 | 기술 | ADR |
|------|------|-----|
| 런타임 | Node.js 24 LTS (ESM, `"type": "module"`) | — |
| 언어 | TypeScript 5.9 (strict, `moduleResolution: NodeNext`) | — |
| 백엔드 | Fastify 5 + `@fastify/jwt` + `@fastify/websocket` | ADR-001 · ADR-005 |
| DB | SQLite (better-sqlite3) + Drizzle ORM | 기확정 · ADR-011(FTS5) |
| CLI | Commander + undici | ADR-003 |
| 개발/빌드 | tsx(개발) · tsup(배포) | RISK-003 완화 |
| 린트·포맷 | Biome (단일 도구) | — |
| 프론트엔드 | React + Vite + Tailwind + shadcn/ui — **Phase 2** | ADR-002 · 006 · 007 |

## 코딩 규칙

- 파일명: kebab-case (예: `project.service.ts`, `agents.routes.ts`)
- 변수/함수: camelCase
- 타입/인터페이스: PascalCase, 접미사 없음
- Enum 상수: `as const` 객체 + 동명 타입 (DES-009 패턴)
- **import는 상대 경로 + `.js` 확장자** — 경로 별칭을 쓰지 않는다.
  tsc(NodeNext)와 Vite가 별칭을 다르게 해석해 "테스트는 통과하는데
  typecheck는 실패"하는 상태가 생긴다
- **DB 값(snake_case)은 그대로 쓴다** — `pending_completion`, `ceo_approval` 등.
  Biome 네이밍 규칙에 snake_case를 허용해 둔 이유다

## 레이어 규칙 (DES-001 v3.2)

```
Routes     →  Services  →  Repositories  →  Database Plugin  →  SQLite
Jobs       →  Services                 (Repository 직접 접근 금지)
Bootstrap  →  Services                 (동일)
```

1. 단방향 의존만 허용. 역방향 금지
2. Routes는 Service만 호출 (Repository 직접 접근 금지)
3. Repository는 Drizzle 쿼리만 (비즈니스 로직 금지)
4. State Machine은 순수 함수 (외부 의존 없음)
5. WebSocket Hub는 **출력 전용** — Hub가 Service를 호출하지 않는다
6. **교차 애그리거트 트랜잭션은 Route가 조율** — 두 Service를 한 트랜잭션에
   묶어야 하는데 그 방향이 순환을 만들면, Service끼리 부르지 말고 Route
   핸들러가 `db.transaction()` 안에서 순서대로 호출한다

**허용된 Service 간 의존 4건** (순환 아님)
`Stage → Approval → Agent → Conversation`

## 디렉토리 역할

DES-008 v3.1 기준.

- `shared/` — 공유 타입·상수·상태 전이 규칙 (백엔드/CLI 공용)
- `backend/` — Fastify 서버. `plugins/` `routes/` `schemas/` `services/`
  `repositories/` `ws/` `jobs/` `bootstrap/` `db/` `migrations/` `utils/`
- `cli/` — Commander 앱. `commands/` `api-client.ts` `config.ts`
- `frontend/` — 웹 대시보드 UI (**Phase 2**)
