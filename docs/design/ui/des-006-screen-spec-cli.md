# DES-006 화면 명세서 (CLI)

> Phase 1: 기반 구축
> 문서코드: DES-006
> 버전: v2 (2026-09-01) — 인터랙션 명세 규격 적용
> 대상: CLI 19개 화면
> **원본**: [Notion DES-006](https://app.notion.com/p/3c5d066504ec8137980bee851fb061a3) · Git 동기화 2026-09-01
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
| 19개 화면이 모두 §3 표시 데이터에 정의되었는가 | ✅ |
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

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-24 | 최초 작성 — 화면 인벤토리 + 입력/출력 + 네비게이션 맵 |
| v2 | 2026-09-01 | 인터랙션 명세(§4) · 프롬프트 명세(§5) · 전이 매트릭스(§6) 추가, 표시 데이터 필드 단위 확정, 화면 수 19개로 정정 |
