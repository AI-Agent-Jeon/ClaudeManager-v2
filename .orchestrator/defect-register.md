# 결함 레지스터 — Phase 1

> **목적**: 리뷰·테스트에서 발견된 결함의 **개별 항목**을 파일로 보존한다.
> 2026-09-03 재리뷰에서 5·6단계 판정(보통 13 · 낮음 11) 중 **17건의 목록이 소실**된 것이 확인됐다.
> 집계 수치만 `test.json`에 있었고 개별 ID·내용은 세션 보고 텍스트에만 존재해, 세션 단절과 함께 사라졌다.
> 실행 계약 §0이 단계 커서를 파일에 두는 것과 같은 이유로, 결함도 파일에 둔다.
>
> **규칙**: 결함을 발견하면 **발견 즉시** 이 파일에 등재한다. 해소 시 커밋 해시를 적는다. 삭제하지 않는다.

## 범례

- 등급: 치명 / 높음 / 보통 / 낮음
- 상태: 🔴 미처리 · 🟡 결정대기 · 🟢 해소 · ⚪ 마감후

---

## 해소 완료

| ID | 등급 | 내용 | 해소 |
|----|:---:|------|------|
| FIND-01 | 높음 | Project 취소·일시정지가 Task로 전파되지 않음 | 🟢 `3700f2b` |
| FIND-02 | 보통 | `markRead()` 호출 라우트 부재 — unreadCount 영구 미갱신 | 🟢 `1b49607` (D-2) |
| FIND-06 | 높음 | 캐스케이드 경로가 채널 readonly 전환을 건너뜀 | 🟢 `9b03a07` |
| REV-H-02 / SEC-09 | 높음 | 승인 커밋 후 422 — 대표가 승인 여부를 알 수 없는 막다른 길 | 🟢 `2847e14` |
| REV-H-03 | 높음 | `resolveId()`가 try/catch 밖 — 공통 에러 안내 무효화 | 🟢 `2847e14` |
| REV-H-04 | 높음 | `runChatAgentOpen` 메시지 조회 미보호 | 🟢 `2847e14` |
| REV-M-01 | 보통 | `cascadeToAgents`의 `agentRepo` 직접 상태 전이 — 레이어 규칙 10 위반 | 🟢 `3700f2b` |
| REV-M-04 / SEC-07 | 보통 | (1차 루프 처리) | 🟢 `2847e14` |
| REV-M-05 / SEC-05 | 보통 | (1차 루프 처리) | 🟢 `2847e14` |
| REV-M-06 | 보통 | `ArtifactService.upsert` 호출 경로 부재 — FR-031 도달 불가 | 🟢 `feacf35` (D-3) |
| REV-L-02 / SEC-06 / SEC-10 | 낮음 | (1차 루프 처리) | 🟢 `2847e14` |
| REV-L-07 | 낮음 | 공통 에러 매핑 중복 → `mapCommonApiError` 헬퍼로 정리 | 🟢 `2847e14` |
| SEC-04 | 보통 | (1차 루프 처리) | 🟢 `2847e14` |
| NEW-03 | 낮음 | DES-002 `POST /api/approvals` 예시에 필수 `requestedBy` 누락 | 🟢 문서 (커밋 대기) |

## 미처리

| ID | 등급 | 위치 | 내용 | 권고 | 상태 |
|----|:---:|------|------|------|:---:|
| R2-01 | 보통 | `project.service.ts:191` | `ProjectService.updateStatus()` 공개 래퍼가 캐스케이드를 건너뛴다. 호출자 0건(사장 API). 미래 호출자가 쓰면 FIND-01 재발 — "정식 이름의 함수가 조용히 부수효과를 뺀다"는 FIND-01·FIND-06과 동일한 함정 구조 | 🟢 `c3380da` — 삭제. 호출자는 테스트 4곳뿐이었고 updateStatusSync() 직접 호출로 이관 |
| R2-02 | 보통 | `agent.service.ts:406` | `cascadeToTasks()`가 `TaskService`를 거치지 않고 `taskRepo`에 상태 전이를 직접 쓴다 — 문자 그대로 레이어 규칙 10 위반. 오늘은 동작이 같으나 `TaskService`에 부수효과가 붙는 순간 FIND-01이 Task 계층에서 재현 | 🟢 `8e47972` — TaskService.cascadeStatusSync() 추출. AgentService가 TaskService 주입. 허용 의존 4→5건(DES-001 v3.5). 무순환 grep 확인 |
| R2-03 | 보통 | `artifact.repository.ts:155-157` | upsert가 `notion_url`·`git_path`를 무조건 덮어쓴다. 한쪽만 지정해 갱신하면 `syncStatus`가 `synced → git_only`로 조용히 퇴행 — **FR-031의 존재 이유(2026-09-01 오진단 방지)와 정면 충돌**. DES-002 v2.6 명세와 일치하므로 사양 자체의 결함 | 🟢 `b15a835` — COALESCE 적용. 실기동: --notion-url 생략 재등록 후에도 notionUrl 보존·syncStatus synced 유지. DES-002 v2.8 사양 정정 |
| NEW-01 | 보통 | `db/migrate.ts` · `package.json` | `npm run db:migrate` 무동작(no-op) — 배포 절차에서 "마이그레이션 완료"로 오판 | 🟢 `f9f99f7` — runMigrateCli() 진입점. 실기동 확인: 최초 7건 적용·재실행 멱등·실패 시 EXIT_CODE=1 |
| NEW-02 | 낮음 | `approval.ts:645-648` | `requestedBy`가 실재 Agent가 아니어도 "Agent가 재개됩니다" 무조건 출력 | 🟢 `c8ec737` — requesterIsAgent() 검사 후 조건부 출력 |
| R2-04 | 낮음 | `chat.ts:279·326·675` | 읽음 PATCH 실패 시 이미 받은 메시지까지 버리고 채널 열람 전체가 실패 — 주석/동작 불일치 | 마감 후 | ⚪ |
| R2-05 | 낮음 | `artifact.schema.ts:24` | `gitPath`가 클라이언트 입력이 되며 `GET /api/artifacts/:id/content`가 저장소 루트 내 임의 파일 리더가 됨(`.env`·`*.db`). 루트 밖 탈출은 차단됨, 단일 사용자 루프백이라 실위험 낮음 | 마감 후 — `docs/` 접두어 제한 | ⚪ |
| R2-06 | 낮음 | `artifact.schema.ts:23` | `notionUrl`에 `format:'uri'` 없음 — `javascript:` 저장 가능. Phase 2 웹이 링크로 렌더하면 XSS 벡터 | **Phase 2 착수 전 필수** | ⚪ |
| R2-07 | 낮음 | DES-007 §8 vs `agent.repository.ts:144` | Project cancelled 후 `created`·`paused`·`failed` Agent/Task가 비종료로 잔존. DES-007과는 정합 — 코드 결함이 아니라 사양 질문 | 마감 후 대표 판단 | ⚪ |
| WS-01 | 보통 | `des-007 §9` vs 캐스케이드 경로 | DES-007 §9는 상태 변경 시 `WS /ws` `status:changed` 브로드캐스트를 규정하나, `broadcast` 호출은 `approval.service.ts`·`stage.service.ts` 5곳뿐. **상태 캐스케이드 경로에 0건** | WS 엔드포인트 배선 시 함께 처리 | ⚪ |
| PROC-01 | 보통 | 프로세스 | 결함 목록이 파일로 남지 않아 5·6단계 판정 24건 중 **17건(보통 8 · 낮음 9)이 추적 불가** | 이 파일 신설로 재발 방지. 소실분은 복구 불가 | 🟢 |

## 소실된 항목 (복구 불가)

5·6단계 review-sub 판정의 **보통 8건 · 낮음 9건**은 개별 ID·내용이 어디에도 파일로 남지 않아 재구성할 수 없다.
저장소 전수 grep으로 추적 가능한 것만 위 표에 있다. Phase 1 마감을 막지는 않으나, 이 상태로 마감하면 영구 추적 불가가 된다.
**다음 리뷰(Phase 2)에서 같은 코드 범위를 다시 리뷰하면 일부가 재발견될 수 있다.**
