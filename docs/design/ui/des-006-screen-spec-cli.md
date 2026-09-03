# DES-006 화면 명세서 (CLI)

> Phase 1: 기반 구축
> 문서코드: DES-006
> 버전: **v3.5 (2026-09-03)** — `cm artifacts add` 옵션명 오기 정정(`--stage`→`--skill`, DES-006 문서 결함) + `cm chat main`/`agent <id>`/`log` 읽음 처리 서술 갱신(D-2) + `cm artifacts add` 화면 신설(D-3)
> 대상: **CLI 34개 화면** (기존 19 + 대화·승인·진행 15)
> **원본**: [Notion DES-006](https://app.notion.com/p/3c5d066504ec8137980bee851fb061a3) · Git 동기화 2026-09-03
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

## 목적

Phase 1의 모든 CLI 화면을 **"어느 화면에서 무엇을 조작하면 → 무엇이 뜨고 → 거기서 어떤 데이터를 보는가"** 단위로 명세한다. 개발 시 이 문서의 출력 형식과 인터랙션을 그대로 구현한다.

## v1 대비 변경점

| 구분 | v1 | v2 |
|------|----|----|
| 인터랙션 명세 | 없음 (입력/출력만) | 전 화면 이벤트 단위 표 (§4) |
| 팝업 명세 | 없음 | 대화형 프롬프트 PRM-xx 독립 명세 (§5) |
| 화면 전이 | 네비게이션 맵(그래프)만 | 전이 매트릭스 + 트리거·조건 명시 (§6) |
| 표시 데이터 | "상세 표시" 수준 | 필드명 단위 나열 |
| 화면 수 | 본문 "17개" / 표 19행 (불일치) | **19개**로 확정 |

---

## 1. GUI / CLI 용어 대응

CLI에는 버튼·모달이 없다. 아래 대응 관계로 GUI 명세 구조를 그대로 적용한다.

| 개념 | GUI | 이 문서(CLI)에서의 대응물 |
|------|-----|------------------------|
| 화면 | 페이지 | 명령어 1회 실행 결과 |
| 버튼 클릭 | 클릭 이벤트 | 명령어·옵션·인자 입력 |
| 팝업/모달 | 모달 다이얼로그 | **대화형 프롬프트** (`y/N` 확인, 마스킹 입력) |
| 토스트 | 일시 알림 | 실행 직후 `✓` / `✗` 1행 요약 |
| 화면 이동 | 라우트 전환 | **후속 명령 안내** (다음에 칠 명령을 출력에 명시) |
| 인라인 갱신 | 부분 리렌더 | 재조회 명령 안내 |
| 비활성 버튼 | disabled | 허용되지 않는 전이 → `✗` + 허용 목록 출력 |

---

## 2. 화면 인벤토리

| 화면 ID | 명령어 | 기능 | 요구사항 | 인증 |
|---------|--------|------|---------|------|
| SCR-S01 | `npm run server:start` | 서버 시작 | FR-001, DAT-001, DAT-002 | 불필요 |
| SCR-S02 | `Ctrl+C` (SIGINT/SIGTERM) | 서버 종료 | FR-001 | 불필요 |
| SCR-A01 | `cm auth login` | 로그인 (JWT 발급) | FR-002 | 불필요 |
| SCR-A02 | `cm auth logout` | 로그아웃 | FR-002 | 불필요 |
| SCR-A03 | `cm auth status` | 인증 상태 확인 | FR-002, NFR-002 | 불필요 |
| SCR-P01 | `cm project create` | 프로젝트 생성 | FR-003 | 필요 |
| SCR-P02 | `cm project list` | 프로젝트 목록 | FR-004 | 필요 |
| SCR-P03 | `cm project status <id>` | 프로젝트 상세 | FR-005 | 필요 |
| SCR-P04 | `cm project status <id> --set` | 프로젝트 상태 변경 | FR-006 | 필요 |
| SCR-AG01 | `cm agent create` | Agent 생성 | FR-007 | 필요 |
| SCR-AG02 | `cm agent list` | Agent 목록 | FR-007 | 필요 |
| SCR-AG03 | `cm agent status <id>` | Agent 상세 | FR-007 | 필요 |
| SCR-AG04 | `cm agent status <id> --set` | Agent 상태 변경 | FR-007 | 필요 |
| SCR-AG05 | `cm agent delete <id>` | Agent 삭제 | FR-007 | 필요 |
| SCR-T01 | `cm task create` | Task 생성 | FR-008 | 필요 |
| SCR-T02 | `cm task list` | Task 목록 | FR-008 | 필요 |
| SCR-T03 | `cm task status <id>` | Task 상세 | FR-008 | 필요 |
| SCR-T04 | `cm task status <id> --set` | Task 상태 변경 | FR-008 | 필요 |
| SCR-SC01 | `cm status-changes` | 상태 변경 이력 | FR-009 | 필요 |
| **SCR-CH01** | `cm chat main` | Main과 대화 (REPL) | **FR-026, FR-027** | 필요 |
| **SCR-CH02** | `cm chat agent <id>` | Agent와 대화 (REPL) | **FR-026, FR-027** | 필요 |
| **SCR-CH03** | `cm chat send <채널> "<본문>"` | 비대화형 1회 전송 | **FR-027** | 필요 |
| **SCR-CH04** | `cm inbox` | 미응답 의사결정 목록 | **FR-028** | 필요 |
| **SCR-CH05** | `cm decide <id> --approve|--reject` | 의사결정 응답 | **FR-028** | 필요 |
| **SCR-CH06** | `cm progress` | Phase 진행 보드 + WIP 검사 | **FR-029** | 필요 |
| **SCR-CH07** | `cm approvals [--pending|--resolved]` | 승인함 목록 | **FR-028** | 필요 |
| **SCR-CH08** | `cm review <id>` | 승인 건 상세 (안건·산출물·근거·영향) | **FR-028** | 필요 |
| **SCR-CH09** | `cm stage start <skill>` | 단계 착수 (게이트 3단 검증) | **FR-030** | 필요 |
| **SCR-CH14** | `cm stage complete <skill>` | 단계 완료 | **FR-030** | 필요 |
| **SCR-CH10** | `cm artifacts [--sync <상태>]` | 산출물 + 동기화 상태 | **FR-031** | 필요 |
| **SCR-CH15** | `cm artifacts add --skill <skill> --code <코드> --title "<제목>" [--notion-url <url>] [--git-path <경로>]` | 산출물 등록 (upsert) | **FR-031** | 필요 |
| **SCR-CH11** | `cm chat list [--type|--status]` | 대화 채널 목록 (아카이브 포함) | **FR-026** | 필요 |
| **SCR-CH12** | `cm chat log <채널id> [--since]` | 대화 본문 출력·내보내기 | **FR-027** | 필요 |
| **SCR-CH13** | `cm chat search "<검색어>"` | 전 채널 전문 검색 (FTS5) | **FR-027** | 필요 |

**합계 34화면** — 기존 19 + 대화·승인·진행 15 (v3 13종 + v3.2 신규 1종 `SCR-CH14` + v3.4 신규 1종 `SCR-CH15`). PLN-002 v3 "CLI 화면 19 → 32"는 **34로 갱신**한다 — v3.2에서 `cm stage complete`(대표 결정 A안) +1건(+3%), v3.4에서 `cm artifacts add`(대표 결정 D-3) +1건(+3%), §5 범위 변경 트리거 모두 미발동.
**ID는 §2 채번 순서(CH01~CH13, 이어서 CH14·CH15)를 유지**하되, 짝을 이루는 화면은 표에서 인접 배치한다 — `start`·`complete`는 SCR-CH09 바로 뒤, **`cm artifacts add`(SCR-CH15)는 SCR-CH10 바로 뒤**(조회·등록이 한 쌍임을 보이기 위해). 이하 §3-1·§4-5의 표에도 같은 배치를 적용한다.

---

## 3. 화면별 표시 데이터 정의

각 화면이 실제로 출력하는 **필드 전체**를 정의한다. 개발 시 이 목록 외 필드를 임의로 추가하지 않는다.

| 화면 ID | 표시 데이터 (필드 전체) | 출처 |
|---------|----------------------|------|
| SCR-S01 | 버전, 서버 URL, DB 경로, (최초 1회) 초기 시크릿, 마이그레이션 로그(테이블명·인덱스 수), 플러그인 로드, 라우트 등록(그룹 수·엔드포인트 수), Listening 주소 | package.json + 환경변수 + drizzle |
| SCR-S02 | 수신 시그널명, 대기 중 요청 수, 타임아웃 값, DB 연결 종료, 종료 결과(정상/강제) | 프로세스 상태 |
| SCR-A01 | 서버 URL, 인증 결과, 토큰 저장 경로, 만료일시 | POST /api/auth/login |
| SCR-A02 | 로그아웃 결과, 토큰 삭제 경로 | 로컬 파일 |
| SCR-A03 | 인증 여부, 서버 URL + 연결 상태, 토큰 유효성, 만료일시 + 잔여일 | GET /api/health |
| SCR-P01 | ID(전체 UUID), 이름, 상태, 설명, 생성일시 | POST /api/projects |
| SCR-P02 | 행별: ID(8자), 이름, 상태, 생성일시 / 하단: 페이지 n/m, 총 건수, 적용 필터 | GET /api/projects |
| SCR-P03 | ID, 이름, 상태, 설명, 생성일시, 수정일시 + Agent 목록(ID·이름·유형·상태·스킬) + 허용 상태 전이 목록 | GET /api/projects/:id |
| SCR-P04 | 프로젝트명, ID, 이전상태 → 이후상태, 변경일시 + (취소 시) 캐스케이드 대상 전체 목록 | PATCH /api/projects/:id/status |
| SCR-AG01 | ID(전체 UUID), 이름, 유형, 소속 프로젝트(이름+ID), 스킬, 상태, 생성일시 | POST /api/agents |
| SCR-AG02 | 행별: ID(8자), 이름, 유형, 스킬, 상태, 생성일시 / 하단: 페이지 n/m, 총 건수 | GET /api/agents |
| SCR-AG03 | ID, 이름, 유형, 소속 프로젝트, 스킬, 상태, 재시도 n/3, 생성일시, 수정일시 + Task 목록(ID·제목·상태·생성일시) + 허용 상태 전이 | GET /api/agents/:id |
| SCR-AG04 | Agent명, ID, 소속 프로젝트, 이전상태 → 이후상태, 변경일시 + (취소 시) 캐스케이드 Task 목록 | PATCH /api/agents/:id/status |
| SCR-AG05 | Agent명, ID, 삭제 대상 Task 건수, 삭제 결과 | DELETE /api/agents/:id |
| SCR-T01 | ID(전체 UUID), 제목, 소속 Agent(이름+ID), 상태, 설명, 생성일시 | POST /api/tasks |
| SCR-T02 | 행별: ID(8자), 제목, 상태, 생성일시 / 하단: 페이지 n/m, 총 건수 | GET /api/tasks |
| SCR-T03 | ID, 제목, 소속 Agent, 상태, 설명, 생성일시, 수정일시 + 허용 상태 전이 | GET /api/tasks/:id |
| SCR-T04 | Task 제목, ID, 소속 Agent, 이전상태 → 이후상태, 변경일시 | PATCH /api/tasks/:id/status |
| SCR-SC01 | 행별: 시각, 엔티티 유형, (필터 없을 때) ID(8자), From, To, 변경자 / 하단: 페이지 n/m, 총 건수 | GET /api/status-changes |

### 3-1. 대화·승인·진행 15화면 — **v3.1 신규 13 + v3.2 신규 1 + v3.4 신규 1**

> DES-002 v2.1 응답 스키마에서 도출했다. **응답 필드에 없는 것을 화면에 만들지 않는다.**

| 화면 ID | 표시 데이터 (필드 전체) | 출처 |
|---------|----------------------|------|
| SCR-CH01 | 채널 제목(Main), 최근 메시지 20건 — 행별: 시각, 발신자(`대표`/`Main`/`Agent`/`시스템`), 유형 배지(MSG-01~06), 본문. **MSG-03은 4단 접기**(요약·수행내용·산출물·미해결), **MSG-04는 ⚠ 카드**(안건·선택지·승인ID(8자)·`cm decide` 안내), **MSG-05는 접힌 시스템 라인** / 하단: REPL 프롬프트 `>`, WS 연결 상태 | GET /api/conversations?type=main → GET /api/conversations/:id/messages · **PATCH .../read**(진입 시 읽음 처리, v3.3 · D-2) · WS |
| SCR-CH02 | SCR-CH01 전부 + 채널 제목(Agent명), **Agent 상태 + `waiting_reason`**, 채널 상태(active/readonly/archived). `readonly`·`archived`면 입력창 대신 "읽기 전용" 안내 | 동일 + GET /api/agents/:id + **PATCH .../read**(진입 시 읽음 처리, `readonly`·`archived`도 호출 대상) |
| SCR-CH03 | ✓ 전송 완료, 메시지 ID(8자), 채널 제목, 전송 시각 | POST /api/conversations/:id/messages |
| SCR-CH04 | 행별: 승인 ID(8자), 유형(APV-*), 등급, 안건, 요청자, **경과 시간**, **잔여 시간**(보통 등급만 · 높음은 `무기한`) / 하단: 총 건수 + `cm review <id>` 안내 | GET /api/approvals?status=pending |
| SCR-CH05 | 승인 ID, 안건, 결정(승인/반려/조건부), 채택 선택지 코드·라벨, 사유, 처리 시각 + **Agent 재개 여부**(반려면 "대기 유지") + APV-GATE 승인 시 다음 단계명 + `cm stage start <skill>` 안내 | POST /api/approvals/:id/resolve |
| SCR-CH06 | Phase 번호·이름·시작일·경과일수 / 7단계 각각: 스킬명, 상태(대기·진행·완료), 산출물 건수, 승인대기 건수, 시작~완료일 / **게이트 2곳**(plan→analyze, test→deploy) 위치 + 통과 여부 / **WIP 위반 목록**: 규칙, 상세, 면제 여부 + 조치 명령 안내 | GET /api/phases/current |
| SCR-CH07 | 행별: 승인 ID(8자), 유형, 등급, 안건, 상태, 요청자, 경과/잔여 / 하단: 페이지 n/m, 총 건수, 적용 필터(`--pending`/`--resolved`) | GET /api/approvals |
| SCR-CH08 | **안건 블록**: 안건, 유형, 등급, 단계, 요청자, 요청시각(경과) / **산출물**: 코드, 제목, Git 경로, Notion URL, **동기화 상태** / **선택지**: 코드, 라벨, 권고 표시 / **근거** / **영향 범위**: 되돌림 가능 여부, 영향 문서 목록 / 응답 명령 2행 안내 | GET /api/approvals/:id |
| SCR-CH09 | 대상 단계, 직전 단계 상태, 게이트 필요 여부 + 승인 ID + 통과 여부, WIP 검사 결과, 착수 결과(`pending → in_progress`), 착수 시각 / **실패 시**: 걸린 가드 번호(1~3) + 사유 + 해결 명령 | POST /api/stages/:id/start |
| SCR-CH14 | 대상 단계, 처리 전 상태, 완료 결과(`in_progress → completed`), 완료 시각 / **실패 시**: `STAGE_NOT_FOUND` 또는 `INVALID_TRANSITION` + 현재 상태 + 사유. **`phases.current_stage`는 바뀌지 않는다는 안내 1행**(다음 단계는 `cm stage start`로 별도 착수) | POST /api/stages/:id/complete |
| SCR-CH10 | 행별: 코드, 제목, 상태(draft/review/approved), **동기화 상태**(synced/notion_only/git_only/missing), Notion ✅❌, Git ✅❌, 최종수정 / 하단: 단계 필터, 총 건수 + **경고블록 — `notion_only`는 동기화 누락이지 프로세스 위반이 아니다** | GET /api/artifacts |
| SCR-CH15 | ✓ 등록/갱신 완료, 산출물 코드, 제목, 소속 단계, **동작 구분**(신규 등록 / 기존 갱신), **동기화 상태**(등록 직후 파생값 — Notion/Git ✅❌), 처리 시각 / **실패 시**: `VALIDATION_ERROR`(필수 옵션 누락) 또는 `STAGE_NOT_FOUND` + `cm progress` 안내 | POST /api/artifacts |
| SCR-CH11 | 행별: 채널 ID(8자), 종류(main/agent), 제목, 상태, **미읽음 수**, 마지막 메시지 시각 / 아카이브 채널은 제목 뒤 `(삭제됨)` 표기(`entitySnapshot.agentName` 사용) / 하단: 적용 필터, 총 건수 | GET /api/conversations |
| SCR-CH12 | 채널 제목, 조회 기간, 메시지 전문 — 행별: 시각, 발신자, 유형, 본문(**MSG-03은 4단 전개**) / 하단: 총 건수, `--since` 적용값 | GET /api/conversations/:id/messages · /export · **PATCH .../read**(조회 시 읽음 처리, v3.3 · D-2) |
| SCR-CH13 | 행별: 채널 제목, 시각, **snippet**(`<mark>` → 터미널 강조), 메시지 ID(8자) / 하단: 검색어, 총 건수 + **경고블록 — 한국어 조사로 인한 미검출 가능성**(DES-003 §3-3) | GET /api/conversations/search |

> **공통 규칙**: ID는 목록에서 8자, 단건 출력에서 전체 UUID. 시각은 `YYYY-MM-DD HH:mm:ss`(로컬). 경과·잔여 시간은 서버가 계산해 내려준 `elapsedSeconds`·`remainingSeconds`를 사람이 읽는 형태로 변환한다(예: `1시간 12분 경과`).
>
> **SCR-CH05의 `cm stage start <skill>` 안내는 `cm stage complete` 신설(v3.2) 후에도 그대로 유효하다.** 게이트 승인(APV-GATE)은 **직전 단계가 이미 `completed`인 상태에서** 다음 단계 착수 허가를 구하는 절차다(DES-007 §7-1 가드 1). 즉 순서는 `cm stage complete <현재 단계>` → (게이트 필요 시) 승인 요청·`cm decide` 처리 → `cm stage start <다음 단계>`다. SCR-CH05는 이 흐름의 마지막 안내이므로 `complete` 명령을 언급할 필요가 없다.
>
> **읽음 처리는 채널 진입 시 자동이다 (v3.3 · D-2).** `cm chat main`·`cm chat agent <id>`가 최근 메시지를 불러온 직후, `cm chat log <채널id>`가 조회를 마친 직후 각각 `PATCH /api/conversations/:id/read`를 호출해 `last_read_at`을 갱신한다. 대표가 별도로 실행하는 명령이 아니다 — SCR-CH11의 **미읽음 수**가 채널을 열면 자동으로 줄어드는 근거가 이것이다. `readonly`·`archived` 채널도 호출 대상이다 — 읽음 처리는 발화가 아니라 열람 기록이므로 `CONVERSATION_ARCHIVED`를 던지지 않는다(DES-002 v2.5 `PATCH /api/conversations/:id/read`).

---

## 4. 인터랙션 명세 ★핵심

**"무엇을 입력하면 → 무엇이 뜨고 → 무슨 데이터를 보는가"**를 이벤트 단위로 정의한다.

`결과 유형`: **출력전환**(다른 화면 출력) · **프롬프트**(대화형 팝업) · **요약토스트**(✓/✗ 1행) · **후속안내**(다음 명령 제시) · **경고블록**(⚠ 부가 정보)

### 4-1. 서버 · 인증

| 이벤트 ID | 화면 | 트리거 | 사전 조건 | 결과 유형 | 대상 | 표시 데이터 | API |
|-----------|------|--------|----------|----------|------|-----------|-----|
| EVT-S01-1 | — | `npm run server:start` | DB 파일 없음 | 출력전환 | SCR-S01 (최초) | 배너 + **초기 시크릿** + 마이그레이션 4테이블/6인덱스 | — |
| EVT-S01-2 | — | `npm run server:start` | DB 파일 있음 | 출력전환 | SCR-S01 (재시작) | 배너(existing) + "No pending migrations" | — |
| EVT-S01-3 | SCR-S01 | 포트 점유 상태로 실행 | — | 요약토스트 | — | EADDRINUSE + 해결 명령 `CM_PORT=3001 …` | — |
| EVT-S02-1 | SCR-S01 | `Ctrl+C` | 서버 실행 중 | 출력전환 | SCR-S02 | 시그널명, 활성 요청 수, DB 종료, "Server stopped" | — |
| EVT-S02-2 | SCR-S02 | 10초 경과 | 활성 요청 잔존 | 경고블록 | — | "Shutdown timeout exceeded" + "(forced)" | — |
| EVT-A01-1 | — | `cm auth login` | 서버 실행 중 | **프롬프트** | **PRM-01** 시크릿 입력 | 서버 URL, 마스킹 입력창 | — |
| EVT-A01-2 | PRM-01 | 올바른 시크릿 입력 | — | 요약토스트 + 후속안내 | — | ✓ 인증 성공, 토큰 저장 경로, 만료일시(7일) | POST /api/auth/login |
| EVT-A01-3 | PRM-01 | 잘못된 시크릿 입력 | — | 요약토스트 | — | ✗ "시크릿이 올바르지 않습니다" | POST /api/auth/login |
| EVT-A01-4 | PRM-01 | 서버 미기동 | — | 요약토스트 + 후속안내 | — | ✗ 연결 불가 + `npm run server:start` | — |
| EVT-A02-1 | — | `cm auth logout` | 토큰 존재 | 요약토스트 | — | ✓ 로그아웃, 토큰 삭제 경로 | — |
| EVT-A03-1 | — | `cm auth status` | 토큰 유효 | 출력전환 | SCR-A03 | 서버 URL(connected), 토큰 유효, 만료일시 + 잔여일 | GET /api/health |
| EVT-A03-2 | — | `cm auth status` | 토큰 없음 | 출력전환 + 후속안내 | SCR-A03 | ✗ 미인증 + `cm auth login` | — |
| EVT-A03-3 | — | `cm auth status` | 토큰 만료 | 출력전환 + 후속안내 | SCR-A03 | ✗ 만료일시 + 경과일 + `cm auth login` | — |
| EVT-A03-4 | — | `cm auth status` | 서버 unreachable | 출력전환 | SCR-A03 | ⚠ 토큰 존재(유효성 확인 불가), 서버 unreachable | — |

### 4-2. 프로젝트

| 이벤트 ID | 화면 | 트리거 | 사전 조건 | 결과 유형 | 대상 | 표시 데이터 | API |
|-----------|------|--------|----------|----------|------|-----------|-----|
| EVT-P01-1 | — | `cm project create --name` | 인증됨, 이름 미중복 | 출력전환 + 후속안내 | SCR-P01 | 전체 UUID, 이름, 상태(ready), 설명, 생성일시 | POST /api/projects |
| EVT-P01-2 | — | `--name` 누락 | — | 요약토스트 | — | ✗ 필수 옵션 + 사용법 1행 | — |
| EVT-P01-3 | — | 중복 이름 | — | 요약토스트 | — | ✗ 중복 이름 + 입력값 에코 | POST /api/projects |
| EVT-P02-1 | — | `cm project list` | 데이터 ≥1 | 출력전환 | SCR-P02 | 표(ID8·이름·상태·생성일시) + 페이지 n/m + 총 건수 | GET /api/projects |
| EVT-P02-2 | — | `--status running` | — | 출력전환 | SCR-P02 | 필터된 표 + "filtered by: running" | GET /api/projects?status= |
| EVT-P02-3 | — | `cm project list` | 데이터 0 | 후속안내 | SCR-P02 | "프로젝트가 없습니다" + `cm project create --name <이름>` | GET /api/projects |
| EVT-P02-4 | SCR-P02 | 목록의 ID로 상세 조회 | — | 출력전환 | SCR-P03 | 프로젝트 6필드 + Agent 목록 + 허용 전이 | GET /api/projects/:id |
| EVT-P03-1 | — | `cm project status <id>` | Agent ≥1 | 출력전환 | SCR-P03 | 박스(6필드) + Agent 표(5열) + 허용 전이 목록 | GET /api/projects/:id |
| EVT-P03-2 | — | `cm project status <id>` | Agent 0 | 출력전환 + 후속안내 | SCR-P03 | 박스 + "Agents: 없음" + `cm agent create --project <id>` | GET /api/projects/:id |
| EVT-P03-3 | — | 없는 ID | — | 요약토스트 + 후속안내 | — | ✗ 찾을 수 없음 + `cm project list` | GET /api/projects/:id |
| EVT-P03-4 | — | 앞 8자리 중복 | — | 출력전환 | — | ✗ 후보 목록(ID·이름) + "더 긴 ID를 입력하세요" | GET /api/projects |
| EVT-P04-1 | SCR-P03 | `--set running` | 전이 허용 | 요약토스트 | — | 프로젝트명, ID, `ready → running`, 변경일시 | PATCH /api/projects/:id/status |
| EVT-P04-2 | SCR-P03 | `--set completed` | 전이 불가 | 요약토스트 | — | ✗ 전이 불가 + 현재 상태 + **허용된 전이 목록** | PATCH /api/projects/:id/status |
| EVT-P04-3 | SCR-P03 | `--set cancelled` | 하위 존재 | 요약토스트 + **경고블록** | — | 상태 전이 + ⚠ 캐스케이드: Agent n건·Task m건 **각각의 이름과 전이** | PATCH /api/projects/:id/status |

### 4-3. Agent

| 이벤트 ID | 화면 | 트리거 | 사전 조건 | 결과 유형 | 대상 | 표시 데이터 | API |
|-----------|------|--------|----------|----------|------|-----------|-----|
| EVT-AG01-1 | SCR-P03 | `cm agent create --project --name` | 프로젝트 존재, 이름 미중복 | 출력전환 + 후속안내 | SCR-AG01 | 전체 UUID, 이름, 유형, 프로젝트(이름+ID), 스킬, 상태(created), 생성일시 | POST /api/agents |
| EVT-AG01-2 | — | 없는 프로젝트 ID | — | 요약토스트 + 후속안내 | — | ✗ 프로젝트 없음 + `cm project list` | POST /api/agents |
| EVT-AG01-3 | — | 프로젝트 내 이름 중복 | — | 요약토스트 | — | ✗ 동일 이름 존재 + 입력값 에코 | POST /api/agents |
| EVT-AG02-1 | — | `cm agent list --project` | Agent ≥1 | 출력전환 | SCR-AG02 | 표(ID8·이름·유형·스킬·상태·생성일시) + 페이지 | GET /api/agents?projectId= |
| EVT-AG02-2 | — | `cm agent list --project` | Agent 0 | 후속안내 | SCR-AG02 | "Agent가 없습니다" + `cm agent create --project <id>` | GET /api/agents?projectId= |
| EVT-AG02-3 | SCR-AG02 | 목록의 ID로 상세 조회 | — | 출력전환 | SCR-AG03 | Agent 9필드 + Task 목록 + 허용 전이 | GET /api/agents/:id |
| EVT-AG03-1 | — | `cm agent status <id>` | Task ≥1 | 출력전환 | SCR-AG03 | 박스(ID·이름·유형·프로젝트·스킬·상태·**재시도 n/3**·생성·수정) + Task 표 + 허용 전이 | GET /api/agents/:id |
| EVT-AG03-2 | — | `cm agent status <id>` | Task 0 | 출력전환 + 후속안내 | SCR-AG03 | 박스 + "Tasks: 없음" + `cm task create --agent <id>` | GET /api/agents/:id |
| EVT-AG04-1 | SCR-AG03 | `--set running` | 상위 프로젝트 running/waiting | 요약토스트 | — | Agent명, ID, 프로젝트, `created → running`, 변경일시 | PATCH /api/agents/:id/status |
| EVT-AG04-2 | SCR-AG03 | `--set running` | **상위 프로젝트 비활성** | 요약토스트 + 후속안내 | — | ✗ 프로젝트 비활성 + 프로젝트명·현재상태 + `cm project status <id> --set running` | PATCH /api/agents/:id/status |
| EVT-AG04-3 | SCR-AG03 | `--set cancelled` | Task 존재 | 요약토스트 + **경고블록** | — | 상태 전이 + ⚠ 캐스케이드 Task n건 **각각의 제목과 전이** | PATCH /api/agents/:id/status |
| EVT-AG05-1 | SCR-AG03 | `cm agent delete <id>` | Task ≥1 | **프롬프트** | **PRM-02** 캐스케이드 삭제 확인 | ⚠ 경고문, Agent명+ID, **Task 건수** | — |
| EVT-AG05-2 | SCR-AG03 | `cm agent delete <id>` | Task 0 | **프롬프트** | **PRM-03** 단순 삭제 확인 | Agent명+ID (1행) | — |
| EVT-AG05-3 | PRM-02/03 | `y` 입력 | — | 요약토스트 + 후속안내 | SCR-AG02 | ✓ 삭제 완료, Agent명, **삭제된 Task 건수** | DELETE /api/agents/:id |
| EVT-AG05-4 | PRM-02/03 | `n` 또는 Enter | — | 요약토스트 | — | "삭제가 취소되었습니다" | — |
| EVT-AG05-5 | — | `--force` | — | 요약토스트 | — | 프롬프트 생략, ✓ 삭제 완료 + Task 건수 | DELETE /api/agents/:id |

### 4-4. Task · 이력

| 이벤트 ID | 화면 | 트리거 | 사전 조건 | 결과 유형 | 대상 | 표시 데이터 | API |
|-----------|------|--------|----------|----------|------|-----------|-----|
| EVT-T01-1 | SCR-AG03 | `cm task create --agent --title` | Agent 존재 | 출력전환 | SCR-T01 | 전체 UUID, 제목, Agent(이름+ID), 상태(ready), 설명, 생성일시 | POST /api/tasks |
| EVT-T01-2 | — | `--title` 누락 | — | 요약토스트 | — | ✗ 필수 옵션 + 사용법 1행 | — |
| EVT-T02-1 | — | `cm task list --agent` | Task ≥1 | 출력전환 | SCR-T02 | 표(ID8·제목·상태·생성일시) + 페이지 | GET /api/tasks?agentId= |
| EVT-T02-2 | — | `cm task list --agent` | Task 0 | 후속안내 | SCR-T02 | "Task가 없습니다" + `cm task create --agent <id>` | GET /api/tasks?agentId= |
| EVT-T02-3 | SCR-T02 | 목록의 ID로 상세 조회 | — | 출력전환 | SCR-T03 | Task 7필드 + 허용 전이 | GET /api/tasks/:id |
| EVT-T03-1 | — | `cm task status <id>` | 존재 | 출력전환 | SCR-T03 | 박스(ID·제목·Agent·상태·설명·생성·수정) + 허용 전이 | GET /api/tasks/:id |
| EVT-T04-1 | SCR-T03 | `--set in_progress` | 상위 Agent running | 요약토스트 | — | Task 제목, ID, Agent, `ready → in_progress`, 변경일시 | PATCH /api/tasks/:id/status |
| EVT-T04-2 | SCR-T03 | `--set in_progress` | **상위 Agent 비활성** | 요약토스트 + 후속안내 | — | ✗ Agent 비활성 + Agent명·현재상태 + `cm agent status <id> --set running` | PATCH /api/tasks/:id/status |
| EVT-T04-3 | SCR-T03 | 허용되지 않는 `--set` | — | 요약토스트 | — | ✗ 전이 불가 + 현재 상태 + 허용 전이 목록 | PATCH /api/tasks/:id/status |
| EVT-SC01-1 | SCR-T04 | `cm status-changes --entity-id` | 이력 ≥1 | 출력전환 | SCR-SC01 | 표(시각·엔티티·From·To·변경자) + 페이지 | GET /api/status-changes |
| EVT-SC01-2 | — | `cm status-changes` (무필터) | — | 출력전환 | SCR-SC01 | 표 + **ID 컬럼 추가** + 페이지 | GET /api/status-changes |
| EVT-SC01-3 | — | 이력 없는 엔티티 | — | 출력전환 | SCR-SC01 | "상태 변경 이력이 없습니다" | GET /api/status-changes |

---

### 4-5. 대화 · 승인 · 진행 — **v3 신규 13화면 + v3.2 신규 1화면**

> D-09(대화) · D-16(승인 게이트) 승인으로 Phase 1에 편입. DES-013 §5 · DES-014 §6 정의를 인터랙션 규격으로 옮긴다.

#### 대화 (SCR-CH01~03 · 11~13)

| 이벤트 ID | 화면 | 트리거 | 사전 조건 | 결과 유형 | 대상 | 표시 데이터 | API |
|-----------|------|--------|----------|----------|------|-----------|-----|
| EVT-CH01-1 | — | `cm chat main` | 인증됨 | 출력전환 | SCR-CH01 | 최근 메시지 20건 + REPL 프롬프트 `>` | GET /api/conversations/:id/messages |
| EVT-CH01-2 | SCR-CH01 | 본문 입력 후 Enter | 채널 `active` | 인라인추가 | SCR-CH01 | 우측 정렬 `[대표]` 1행 + 전송 표시 | POST /api/conversations/:id/messages |
| EVT-CH01-3 | SCR-CH01 | 서버 푸시 도착 | WS 연결됨 | 인라인추가 | SCR-CH01 | 좌측 `[Main]` 또는 `[Agent]` 메시지. MSG-03은 **4단 접기** | WS /ws/conversations/:id |
| EVT-CH01-4 | SCR-CH01 | MSG-04 도착 | — | 경고블록 | SCR-CH01 | ⚠ 의사결정 요청 카드 + 선택지 + `cm decide <id>` 안내 | WS |
| EVT-CH01-5 | SCR-CH01 | `Ctrl+D` 또는 `/exit` | — | 요약토스트 | — | ✓ 세션 종료, 전송 n건 | — |
| EVT-CH01-6 | SCR-CH01 | WS 연결 끊김 | — | 경고블록 | SCR-CH01 | ⚠ 재연결 중… (지수 백오프). 복구 시 **REST로 누락 보충** | GET messages |
| EVT-CH02-1 | — | `cm chat agent <id>` | Agent 존재, 채널 `active` | 출력전환 | SCR-CH02 | Agent명·상태 헤더 + 최근 20건 + REPL | GET /api/conversations |
| EVT-CH02-2 | — | `cm chat agent <id>` | 채널 `readonly`·`archived` | 출력전환 + 경고블록 | SCR-CH02 | 전체 로그 + "종료된 채널입니다 (읽기 전용)". **입력창 없음** | GET messages |
| EVT-CH03-1 | — | `cm chat send main "<본문>"` | 인증됨 | 요약토스트 | — | ✓ 전송 완료 + 메시지 ID 축약 | POST messages |
| EVT-CH03-2 | — | `cm chat send` | 채널 `archived` | 요약토스트 | — | ✗ `CONVERSATION_ARCHIVED` — "종료된 채널에는 보낼 수 없습니다" | POST messages |
| EVT-CH11-1 | — | `cm chat list` | 인증됨 | 출력전환 | SCR-CH11 | 채널ID·유형·제목·상태·미읽음·최근시각. **archived는 dim** | GET /api/conversations |
| EVT-CH11-2 | — | `cm chat list --status archived` | — | 출력전환 | SCR-CH11 | 보관 채널만. **삭제된 Agent 이름이 스냅샷에서 표시됨** | GET /api/conversations |
| EVT-CH12-1 | — | `cm chat log <채널id>` | 채널 존재 | 출력전환 | SCR-CH12 | 전체 메시지 시간순. `--since` 시 필터 | GET messages |
| EVT-CH12-2 | — | `cm chat log <채널id> --export` | — | 요약토스트 | — | ✓ 마크다운 파일 저장 경로 | GET /api/conversations/:id/export |
| EVT-CH13-1 | — | `cm chat search "<검색어>"` | 2자 이상 | 출력전환 | SCR-CH13 | 채널명·시각·**하이라이트 스니펫**. 결과 0건 시 안내 | GET /api/conversations/search |
| EVT-CH13-2 | — | `cm chat search "<1자>"` | — | 요약토스트 | — | ✗ "검색어는 2자 이상이어야 합니다" | — |

#### 승인 (SCR-CH04·05·07·08)

| 이벤트 ID | 화면 | 트리거 | 사전 조건 | 결과 유형 | 대상 | 표시 데이터 | API |
|-----------|------|--------|----------|----------|------|-----------|-----|
| EVT-CH04-1 | — | `cm inbox` | 인증됨 | 출력전환 | SCR-CH04 | **등급·안건·경과시간·기한** + 응답 명령 안내. 기한순 정렬 | GET /api/approvals?status=pending |
| EVT-CH04-2 | — | `cm inbox` | 미응답 0건 | 출력전환 | SCR-CH04 | "대기 중인 의사결정이 없습니다" | GET approvals |
| EVT-CH04-3 | SCR-CH04 | 높음 등급 존재 | — | 경고블록 | SCR-CH04 | ⚠ "무기한 대기 — 대표 처리 전까지 Agent가 멈춰 있습니다" | — |
| EVT-CH07-1 | — | `cm approvals --pending` | 인증됨 | 출력전환 | SCR-CH07 | 유형(APV-*)·등급·안건·상태·경과 | GET /api/approvals |
| EVT-CH07-2 | — | `cm approvals --resolved` | — | 출력전환 | SCR-CH07 | 처리 이력 + **결정·사유·처리시각** | GET /api/approvals |
| EVT-CH08-1 | — | `cm review <id>` | 승인 건 존재 | 출력전환 | SCR-CH08 | **안건·선택지·권고·근거·산출물(동기화 상태 포함)·영향 범위** | GET /api/approvals/:id |
| EVT-CH08-2 | SCR-CH08 | 산출물에 `notion_only` 존재 | — | 경고블록 | SCR-CH08 | ⚠ "Git 동기화 누락 n건" — **프로세스 위반 아님을 명시** | — |
| EVT-CH08-3 | — | `cm review <없는id>` | — | 요약토스트 | — | ✗ `APPROVAL_NOT_FOUND` | GET approvals/:id |
| EVT-CH05-1 | — | `cm decide <id> --approve` | `pending` | 요약토스트 + 후속안내 | — | ✓ 승인 완료 + **Agent 재개 안내**. APV-GATE면 다음 단계명 | POST /api/approvals/:id/resolve |
| EVT-CH05-2 | — | `cm decide <id> --reject --reason "<사유>"` | `pending` | 요약토스트 | — | ✓ 반려 완료 + **"Agent는 대기 상태를 유지합니다"** | POST resolve |
| EVT-CH05-3 | — | `cm decide <id> --reject` (사유 없음) | — | 요약토스트 | — | ✗ `APPROVAL_REASON_REQUIRED` — "반려는 사유가 필요합니다" | POST resolve |
| EVT-CH05-4 | — | `cm decide <id> --approve` | 이미 처리됨 | 요약토스트 | — | ✗ `APPROVAL_ALREADY_RESOLVED` + 기존 결정·처리시각 | POST resolve |
| EVT-CH05-5 | — | `cm decide <id>` (플래그 없음) | `pending` | **프롬프트** | **PRM-CH01** | 안건 요약 + 선택지 + [승인/반려/취소] | — |

#### 진행 (SCR-CH06·09·14·10·15)

| 이벤트 ID | 화면 | 트리거 | 사전 조건 | 결과 유형 | 대상 | 표시 데이터 | API |
|-----------|------|--------|----------|----------|------|-----------|-----|
| EVT-CH06-1 | — | `cm progress` | 인증됨 | 출력전환 | SCR-CH06 | **7단계 보드**(상태·산출물수·승인대기수) + 게이트 위치 + 현재 단계 | GET /api/phases/current |
| EVT-CH06-2 | SCR-CH06 | WIP 위반 존재 | — | 경고블록 | SCR-CH06 | ⚠ WIP 위반 목록 + 면제 여부 + `cm progress --waive` 안내 | GET phases/current |
| EVT-CH06-3 | SCR-CH06 | 게이트 미통과 | — | 경고블록 | SCR-CH06 | ⚠ "plan → analyze 게이트가 통과된 기록이 없습니다" | — |
| EVT-CH09-1 | — | `cm stage start <skill>` | 3단 검증 통과 | 요약토스트 + 후속안내 | — | ✓ 단계 착수 + 시작시각 | POST /api/stages/:id/start |
| EVT-CH09-2 | — | `cm stage start <skill>` | 게이트 미통과 | 요약토스트 + 후속안내 | — | ✗ `GATE_NOT_PASSED` + **필요한 승인 ID** + `cm review <id>` | POST stages/start |
| EVT-CH09-3 | — | `cm stage start <skill>` | 직전 단계 미완료 | 요약토스트 | — | ✗ `INVALID_TRANSITION` + 직전 단계명·현재 상태 | POST stages/start |
| EVT-CH09-4 | — | `cm stage start <skill>` | WIP 위반, 면제 없음 | 요약토스트 + 후속안내 | — | ✗ `WIP_VIOLATION` + 진행 중 단계명 + `cm progress --waive` | POST stages/start |
| EVT-CH14-1 | — | `cm stage complete <skill>` | 대상 단계가 `in_progress` | 요약토스트 + 후속안내 | — | ✓ 완료 처리 + 완료 시각 + **"다음 단계는 `cm stage start <skill>`로 착수하세요"** 안내 (`current_stage` 미변경 고지) | POST /api/stages/:id/complete |
| EVT-CH14-2 | — | `cm stage complete <skill>` | 대상 단계가 `pending`·`completed` | 요약토스트 | — | ✗ `INVALID_TRANSITION` + 현재 상태 + "진행 중 단계만 완료할 수 있습니다" | POST stages/complete |
| EVT-CH14-3 | — | `cm stage complete <skill>` | 존재하지 않는 단계 | 요약토스트 + 후속안내 | — | ✗ `STAGE_NOT_FOUND` + `cm progress` 안내 | POST stages/complete |
| EVT-CH10-1 | — | `cm artifacts` | 인증됨 | 출력전환 | SCR-CH10 | 코드·제목·상태·**Notion/Git 동기화 상태** | GET /api/artifacts |
| EVT-CH10-2 | — | `cm artifacts --sync notion_only` | — | 출력전환 | SCR-CH10 | 한쪽에만 있는 산출물만 필터 | GET artifacts |
| EVT-CH15-1 | — | `cm artifacts add --skill <skill> --code <코드> --title "<제목>"` | 단계 존재, 필수 옵션 충족 | 요약토스트 + 후속안내 | — | ✓ 등록 완료(신규) 또는 ✓ 갱신 완료(기존) + 코드·동기화 상태 + `cm artifacts` 안내 | POST /api/artifacts |
| EVT-CH15-2 | — | `cm artifacts add` | `--skill`·`--code`·`--title` 중 누락 | 요약토스트 | — | ✗ 필수 옵션 + 사용법 1행 | — |
| EVT-CH15-3 | — | `cm artifacts add --skill <없는 skill>` | — | 요약토스트 + 후속안내 | — | ✗ `STAGE_NOT_FOUND` + `cm progress` 안내 | POST artifacts |

> **`cm decide`의 후속 안내가 중요하다.** 승인 후 무엇이 일어나는지(Agent 재개 / 다음 단계 시작)를 알려주지 않으면 대표는 "눌렀는데 뭐가 됐지?"가 된다. 반려 시 **Agent가 대기 상태를 유지한다**는 점도 반드시 알린다 (DES-007 v2 §3-2).

---

## 5. 대화형 프롬프트(팝업) 명세

CLI의 "팝업"에 해당한다. 각 프롬프트는 **독립 화면처럼** 명세하며, 반드시 취소 경로를 갖는다.

| 프롬프트 ID | 호출 이벤트 | 표시 데이터 | 입력 | 기본값 | 응답별 결과 |
|-------------|-----------|-----------|------|--------|-----------|
| PRM-01 | EVT-A01-1 | 서버 URL | 시크릿 (**마스킹**, 터미널 미표시) | 없음 (필수) | 성공→토큰 저장 + 만료일시 출력<br>실패→✗ 시크릿 불일치<br>`Ctrl+C`→중단, 토큰 미변경 |
| PRM-02 | EVT-AG05-1 | ⚠ 경고문, Agent명, Agent ID, **소속 Task 건수** | `y` / `N` | **N** (Enter = 취소) | `y`→삭제 실행 + 삭제된 Task 건수 출력<br>`n`/Enter→"삭제가 취소되었습니다" |
| PRM-03 | EVT-AG05-2 | Agent명, Agent ID (1행) | `y` / `N` | **N** | `y`→삭제 실행<br>`n`/Enter→취소 |

### 프롬프트 공통 규칙

1. 기본값은 항상 **안전한 쪽**(취소)으로 둔다. Enter만 누르면 아무 일도 일어나지 않는다.
2. 파괴적 작업(PRM-02)은 **영향 범위를 수치로** 먼저 보여준다. "Task 2개"처럼 건수를 명시한다.
3. `--force` 옵션으로 프롬프트를 생략할 수 있다. 단 PRM-01(시크릿)은 생략 불가.
4. 비대화형 환경(파이프·CI)에서 프롬프트가 필요하면 실행을 중단하고 `--force` 사용을 안내한다.

---

## 6. 화면 전이 매트릭스

`행 화면`에서 `열 화면`으로 가는 트리거를 정의한다. (— = 직접 전이 없음)

| From \ To | SCR-A01 | SCR-P02 | SCR-P03 | SCR-AG02 | SCR-AG03 | SCR-T02 | SCR-T03 | SCR-SC01 |
|-----------|---------|---------|---------|----------|----------|---------|---------|----------|
| **SCR-S01** | 서버 기동 후 로그인 안내 | — | — | — | — | — | — | — |
| **SCR-A01** | — | 인증 후 목록 조회 | — | — | — | — | — | — |
| **SCR-P01** | — | 생성 후 목록 확인 | 생성 결과 ID로 상세 | — | — | — | — | — |
| **SCR-P02** | — | — | 목록의 ID 지정 | — | — | — | — | — |
| **SCR-P03** | — | — | — | `--project <id>` 지정 | — | — | — | 프로젝트 이력 조회 |
| **SCR-AG01** | — | — | — | 생성 후 목록 확인 | 생성 결과 ID로 상세 | — | — | — |
| **SCR-AG02** | — | — | — | — | 목록의 ID 지정 | — | — | — |
| **SCR-AG03** | — | — | 상위 프로젝트 조회 | — | — | `--agent <id>` 지정 | — | Agent 이력 조회 |
| **SCR-T01** | — | — | — | — | — | 생성 후 목록 확인 | 생성 결과 ID로 상세 | — |
| **SCR-T02** | — | — | — | — | — | — | 목록의 ID 지정 | — |
| **SCR-T03** | — | — | — | — | 상위 Agent 조회 | — | — | Task 이력 조회 |
| **SCR-T04** | — | — | — | — | — | — | 변경 후 상세 재조회 | 변경 이력 확인 |

### 주요 사용 경로

| 경로 | 화면 순서 | 시나리오 |
|------|----------|---------|
| 초기 설정 | S01 → A01(PRM-01) | 서버 기동 후 로그인 |
| 프로젝트 시작 | A01 → P01 → P04(running) | 생성 후 시작 |
| 작업 할당 | P03 → AG01 → AG04(running) → T01 | Agent 등록·시작·Task 할당 |
| 작업 완료 | T04(in_progress) → T04(in_review) → T04(completed) | 진행 → 검토 → 완료 |
| 드릴다운 | P02 → P03 → AG02 → AG03 → T02 → T03 | 프로젝트에서 Task까지 |
| 정리 | AG05(PRM-02) → AG02 | Agent 삭제 후 목록 확인 |
| 감사 | SC01 | 엔티티 상태 변경 추적 |

---

## 7. 상태별 허용 동작

GUI의 "활성/비활성 버튼"에 대응한다. 허용되지 않는 전이는 `✗` + **허용 목록**을 반드시 함께 출력한다.

### 프로젝트

| 현재 상태 | 허용 전이 | 차단 시 안내 |
|----------|----------|-------------|
| ready | running, cancelled | "허용된 전이: running, cancelled" |
| running | waiting, paused, pending_completion, failed, cancelled | 동일 형식 |
| paused | running, cancelled | 동일 형식 |
| completed / cancelled | (종료 상태, 전이 없음) | "종료된 프로젝트입니다" |

### Agent

| 현재 상태 | 허용 전이 | 추가 사전 조건 |
|----------|----------|--------------|
| created | running, cancelled | running 전환 시 **상위 프로젝트가 running/waiting** |
| running | waiting, paused, completed, failed, cancelled | — |
| paused | running, cancelled | 상위 프로젝트 활성 |
| failed | running (재시도), cancelled | 재시도 횟수 < 3 |
| completed / cancelled | (종료 상태) | — |

### Task

| 현재 상태 | 허용 전이 | 추가 사전 조건 |
|----------|----------|--------------|
| ready | in_progress, skipped, cancelled | in_progress 전환 시 **상위 Agent가 running** |
| in_progress | in_review, paused, failed, cancelled | — |
| in_review | completed, in_progress (반려) | — |
| paused | in_progress, cancelled | 상위 Agent running |
| failed | in_progress (재시도), cancelled | — |
| completed / cancelled / skipped | (종료 상태) | — |

### 전이 전체 시나리오 (Task)

```
ready → in_progress → in_review → completed     (정상 완료)
ready → in_progress → in_review → in_progress   (반려 후 재작업)
ready → in_progress → paused → in_progress      (일시정지 후 재개)
ready → in_progress → failed → in_progress      (실패 후 재시도)
ready → skipped                                 (건너뜀)
ready → cancelled                               (취소)
```

---

## 8. 공통 동작 규칙

### 출력 형식

```
✓ {완료 메시지}

  {상세 정보 — 필드명: 값}
```

```
✗ {에러 메시지}
  {상세 설명 또는 해결 명령}
```

### 공통 에러 (전 보호 화면 SCR-P01 ~ SCR-SC01)

| 조건 | 출력 | 복구 경로 |
|------|------|----------|
| 토큰 없음 | ✗ 인증이 필요합니다 | `cm auth login` |
| 토큰 만료 | ✗ 토큰이 만료되었습니다 | `cm auth login` |
| 서버 미연결 | ✗ 서버에 연결할 수 없습니다 + URL | `npm run server:start` |

### ID 축약 규칙

| 맥락 | 표시 | 입력 |
|------|------|------|
| 목록 | UUID 앞 8자리 | — |
| 상세/생성 결과 | 전체 UUID | — |
| 명령어 인자 | — | 앞 8자리 허용 (고유할 때) |
| 축약 충돌 | 후보 목록 출력 + "더 긴 ID를 입력하세요" | 전체 UUID 요구 |

### 출력 컬럼 규칙

| 컬럼 | 너비 | 잘림 처리 |
|------|------|----------|
| ID | 8자 고정 | — |
| Name / Title | 최대 20자 | 초과 시 `...` |
| Status | 10자 | 없음 |
| Created | 19자 (`YYYY-MM-DD HH:mm:ss`) | 고정 |

### 도움말

모든 명령은 `--help`를 지원한다. 출력에는 옵션별 **필수 여부와 검증 규칙**을 포함한다.

---

## 9. 완성도 체크

| 점검 항목 | 확인 |
|----------|------|
| 기존 19개 화면이 §3 표시 데이터에 정의되었는가 | ✅ |
| **신규 13개 화면(SCR-CH01~13)이 §4-5 인터랙션에 정의되었는가** | ✅ **v3** |
| **신규 13개 화면의 §3 표시 데이터 정의** | ✅ **v3.1 완료** — §3-1. DES-002 v2.1 응답 스키마에서 도출 |
| 모든 명령·옵션이 §4 인터랙션 표에 1행 이상 있는가 | ✅ |
| 모든 대화형 프롬프트가 PRM-xx로 정의되고 취소 경로가 있는가 | ✅ |
| `표시 데이터`가 필드명 단위로 적혔는가 | ✅ |
| 각 이벤트에 실패 시 동작이 적혔는가 | ✅ |
| 파괴적 작업에 영향 범위(건수)가 사전 표시되는가 | ✅ |
| 빈 상태(empty state)가 전 목록 화면에 정의되었는가 | ✅ |

---

## 10. 크로스 레퍼런스

| 이 문서 (DES-006) | 참조 문서 |
|------------------|----------|
| 각 이벤트의 API 호출 | DES-002 API 명세서 |
| 상태 전이 규칙 (§7) | DES-007 상태 흐름도 |
| 에러 코드 | DES-009 코드 정의서 |
| 함수 호출 흐름 | DES-004 시퀀스 다이어그램 |
| 사용자 여정 | DES-005 스토리보드 |
| CLI 파일 구조 | DES-008 디렉토리 구조 |
| 웹 UI 화면 명세 (Phase 2) | DES-011 화면 명세서 (웹 UI) |

---

## 미해결 사항

| 항목 | 내용 | 등급 | 처리 시점 |
|------|------|:---:|----------|
| ~~SCR-CH01~13 표시 데이터 정의~~ | ✅ **완료 (2026-09-02)** — §3-1에 13화면 출력 필드 전건 정의. DES-002 v2.1 응답 스키마에서 도출 | 보통 | 완료 |
| **REPL 세션 상태 관리** | `cm chat`은 CLI 유일의 **장기 실행 세션**이다. WS 재연결·Ctrl+C 처리·터미널 리사이즈 동작이 §8 공통 규칙에 없다 | 낮음 | develop |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| **v3.5** | 2026-09-03 | **`cm artifacts add` 옵션명 오기 정정 — 문서 결함(DES-006), test 9단계 수정 루프 2차.** 실제 CLI 구현(`src/cli/commands/progress.ts:901`)은 `--skill <skill>`인데 본 문서는 `--stage <skill>`로 기재되어 있어, **문서대로 명령을 치면 `commander`가 필수 옵션 누락으로 실패한다.** 값이 스킬명(`plan`·`design`…)이므로 `--skill`이 정확한 이름이다 — `--stage`는 stage UUID를 넣으라는 뜻으로 오독된다. §2 SCR-CH15 인벤토리 행·§4-5 EVT-CH15-1~3 예시·옵션 누락 안내 문구 전건 정정. 화면 수·동작 변경 없음(표기만 정정) |
| v1 | 2026-08-24 | 최초 작성 — 화면 인벤토리 + 입력/출력 + 네비게이션 맵 |
| v2 | 2026-09-01 | 인터랙션 명세(§4) · 프롬프트 명세(§5) · 전이 매트릭스(§6) 추가, 표시 데이터 필드 단위 확정, 화면 수 19개로 정정 |
| **v3.1** | 2026-09-02 | **§3-1 신설 — SCR-CH01~13 표시 데이터 전건 정의.** v3은 §4-5 인터랙션("무엇을 입력하면 무엇이 뜨는가")만 정의하고 **§3 형식의 출력 필드 목록을 비워두어**, dev-sub가 화면에 무엇을 찍을지 스스로 정해야 하는 상태였다.<br>DES-002 v2.1 응답 스키마에서 도출했다 — **응답 필드에 없는 것을 화면에 만들지 않는다.** ID 자릿수·시각 포맷·경과 시간 변환 공통 규칙 명시. 미해결 1건 해소 |
| **v3.4** | 2026-09-03 | **`cm artifacts add` 화면 신설 (SCR-CH15) — 대표 결정 D-3, REV-M-06 해소.** `POST /api/artifacts`(DES-002 v2.6) 반영. CLI 화면 **33 → 34**(+1, +3%, §5 범위 트리거 미발동).<br>§2 화면 인벤토리·§3-1 표시 데이터에 SCR-CH15 추가(SCR-CH10 바로 뒤 배치 — 조회·등록이 한 쌍). §4-5 진행 절에 `EVT-CH15-1~3`(성공·필수 옵션 누락·`STAGE_NOT_FOUND`) 추가, EVT-CH14 형식을 그대로 따름 |
| **v3.3** | 2026-09-03 | **읽음 처리 서술 갱신 — 대표 결정 D-2, FIND-02 해소.** `PATCH /api/conversations/:id/read`(DES-002 v2.5) 반영. 신규 화면은 추가하지 않는다(기존 CLI 화면 33 유지) — `cm chat main`(SCR-CH01)·`cm chat agent <id>`(SCR-CH02)·`cm chat log`(SCR-CH12)가 채널 진입·조회 시 이 엔드포인트를 자동 호출하도록 §3-1 출처 열과 §4-5 직후 각주에 명시. `readonly`·`archived` 채널도 호출 대상임을 명시(발화가 아닌 열람 기록) |
| **v3.2** | 2026-09-02 | **`cm stage complete <skill>` 화면 신설 (SCR-CH14) — 대표 결정 A안.** DES-002 v2.4 `POST /api/stages/:id/complete` 신규 반영. CLI 화면 **32 → 33**(+1, +3%, §5 범위 트리거 미발동).<br>§2 화면 인벤토리·§3-1 표시 데이터에 SCR-CH14 추가(SCR-CH09 바로 뒤 배치 — `start`·`complete`가 한 쌍). §4-5 진행 절에 `EVT-CH14-1~3`(성공·`INVALID_TRANSITION`·`STAGE_NOT_FOUND`) 추가, EVT-CH09 형식을 그대로 따름.<br>SCR-CH05(승인 처리) 후속 안내 `cm stage start` 문구는 **그대로 유효함을 확인** — 게이트 승인은 직전 단계가 이미 `completed`인 상태에서 이뤄지므로(DES-007 §7-1 가드 1) `complete`는 그 이전 단계에서 이미 실행된다 |
| **v3** | 2026-09-01 | **대화·승인·진행 13화면 추가** (SCR-CH01~13) — D-09·D-16 승인 반영. 화면 19 → **32개**.<br>§4-5 인터랙션 명세 신규(이벤트 30건), 화면 인벤토리 확장. `cm decide` 후속 안내에 **Agent 재개 여부**를 표시하도록 규정(반려 시 대기 유지). `cm review`에 **동기화 누락이 프로세스 위반이 아님**을 명시하는 경고블록 추가 |
