# 테스트 규칙

## 테스트 프레임워크 (확정 2026-09-02 — 등급 '보통', 자율 판단 후 기록)

**Vitest 3** + `@vitest/coverage-v8`

**근거**
1. Vite가 이미 스택에 있다(ADR-002 React+Vite) — Phase 2에서 도구가 갈리지 않는다
2. TS·ESM을 네이티브로 처리해 별도 transform 설정이 없다 — **RISK-003(TypeScript 빌드 복잡성) 완화**
3. `--coverage`가 내장이라 커버리지 도구를 따로 붙이지 않는다
4. API가 Jest 호환이라 전환 비용이 없다

**기각**: Jest(ESM+TS 설정 부담), `node:test`(커버리지·watch가 빈약)

## 테스트 종류

- 단위 테스트 — `tests/unit/**` (이 스킬의 산출물)
- 통합 테스트 — `tests/integration/**` (test 스킬)
- 시나리오 테스트 — DES-005 스토리보드 7개 시나리오 기반 (test 스킬)

## 규칙

- 테스트 파일: `*.test.ts` (Vitest `include` 패턴이 이것만 잡는다)
- **import는 상대 경로 + `.js` 확장자** — src와 동일. 별칭을 쓰지 않는다
- 테스트는 서로 독립적이어야 한다 (실행 순서에 의존 금지)
- DB가 필요한 테스트는 `tests/fixtures/test-db.ts`의 **인메모리 SQLite**를 쓴다
- 설계서의 값(Enum·전이 맵·CHECK 제약)을 검증하는 테스트는
  **어느 문서 어느 절에서 왔는지 주석으로 남긴다** — 설계가 바뀌면
  테스트가 먼저 깨져야 한다

## 커버리지 기준 (develop 스킬 5단계)

| 대상 | 최소 |
|------|------|
| Must 스토리 관련 코드 | 80% |
| Should 스토리 관련 코드 | 60% |
| 전체 | 70% |

`vitest.config.ts`의 `coverage.thresholds`가 전체 70%를 강제한다.

## TDD 사이클

**Red를 건너뛰지 않는다.** 테스트가 실패하는 것을 먼저 확인해야
그 테스트가 실제로 무언가를 검증한다는 것이 증명된다.

```
Red      수용 기준(Given-When-Then) → 테스트 작성 → 실패 확인
Green    통과하는 최소 코드
Refactor 중복 제거·네이밍 정리 (통과 유지)
```
