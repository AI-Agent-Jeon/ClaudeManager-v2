---
name: design
description: >
  시스템을 설계한다. "설계해줘", "아키텍처", "API 설계",
  "데이터 모델", "ERD", "구조 설계" 등의 요청 시 사용한다.
  C4 Model + API Design First + ERD 정규화 + Atomic Design + 상태 머신 방법론.
version: 2.1
triggers:
  - 설계
  - 아키텍처
  - API 설계
  - 데이터 모델
  - ERD
  - 구조 설계
  - 화면 설계
---

> **이 스킬은 project-agent가 실행합니다.**

## 디스패치

> **필수 선행**: 이 스킬을 실행하기 전에 `.claude/skills/_shared/execution-contract.md`(실행 계약)를 읽는다.
> 아래는 그 계약의 이 스킬용 요약이다. **상세 규칙과 금지 사항은 계약 문서가 기준이며, 충돌 시 계약이 우선한다.**

### 0단계: 재개 확인 (계약 §0)

가장 먼저 `.orchestrator/status/design.json`을 읽는다.

- 없으면 생성하고 `current_step: 1`로 시작한다
- 있으면 `completed_steps`의 **다음 단계부터** 재개한다
- **`completed_steps`에 없는 단계를 수행했다고 가정하지 않는다**
- 각 단계 종료 시 즉시 갱신한다 (몰아서 기록 금지)

### 사전 점검 — 3단 검증 (계약 §1)

**L1 — 존재**

```bash
ls docs/analysis/ 2>/dev/null
git branch --show-current
```

**L2 — 내용**

```bash
for f in docs/analysis/anl-00*.md; do [ -s "$f" ] || echo "EMPTY: $f"; done
# ADR·리스크가 실제로 기재되어 있는가
grep -cE '\bADR-[0-9]{3}\b'  docs/analysis/anl-004-tech-stack.md
grep -cE '\bRISK-[0-9]{3}\b' docs/analysis/anl-003-risks.md
grep -L 'Notion' docs/analysis/*.md
```

> **주의**: `docs/analysis/`가 비어 있다고 해서 analyze를 건너뛴 것으로 단정하지 않는다.
> **Notion `02. 분석`을 반드시 함께 확인한다.** 2026-09-01에 이 확인을 생략해 "analyze 건너뜀"으로 오진단하고 존재하지 않는 안건(D-15)을 상정한 사고가 있었다. 산출물이 Notion에만 있으면 이는 **동기화 누락**이지 프로세스 위반이 아니다 (계약 §3).

**L3 — 정합**

```bash
find docs/analysis -name 'anl-*.md' | wc -l   # 실제 (기대: 4)
```

**판정**: L1 실패 → **Notion `02. 분석` 확인 후** analyze 회귀 제안 · L2 실패 → 해당 문서 회귀(진행 차단) · L3 편차 → 대표 보고(차단 없음)

### 범위 변경 트리거 확인 (계약 §5)

설계 중 산출물이 계획을 초과하면(예: PLN-002 계획 DES-001~009 대비 실제 DES-015) **즉시 보고**한다. 계획 대비 편차는 범위가 조용히 늘어나고 있다는 신호다.

### 위임

사전 점검 통과 시, project-agent를 생성한다:
- subagent_type: `project-agent`
- 전달: 스킬 `design`, 경로 `.claude/skills/design/SKILL.md`
- **함께 전달**: `.claude/skills/_shared/execution-contract.md` 경로와 "이 계약을 먼저 읽고 실행하라"는 지시

### 완료 후

project-agent 완료 시, **아래 검증을 통과하기 전에는 결과를 전달하지 않는다.**

**1. 결정 전파 잔여 확인 (계약 §2)**

승인·결정을 반영한 경우, 옛 표기가 남아 있지 않은지 전수 검색한다.

```bash
grep -rn "<바뀐 옛 표기>" docs/    # 출력이 비어야 통과
```

**"변경 예정" · "반영 대기" · "개정 대상" 상태로 종료하지 않는다.** 이 상태는 다음 세션에서 잊힌다.

**2. 이중 기록 검증 (계약 §3)**

```bash
find docs -name '*.md' ! -name 'CLAUDE.md' -exec grep -L 'Notion' {} +   # 출력이 비어야 통과
```

- Git `docs/` + Notion `02. 프로젝트 / ClaudeManager / 03. 설계` 양쪽에 존재
- 각 문서 헤더에 `> **원본**: [Notion {코드}](url) · Git 동기화 {날짜}`
- `docs/00-progress.md` 동기화 표 + Notion `00. 진행 상황` 갱신

**3. 보고 전 산출물 검증 (계약 §4)**

```bash
for f in <보고서 ## 산출물 칸의 경로 전건>; do
  [ -f "$f" ] && echo "OK   $f" || echo "MISSING $f"
done
```

`MISSING`이 하나라도 있으면 **보고를 중단하고** 누락을 채운다. 채울 수 없으면 산출물 칸에서 지우고 `## 미해결 사항`으로 옮긴다.

**4. 상태 파일 최종 갱신 (계약 §0)**

`.orchestrator/status/design.json`에 `completed_steps` 전건과 `artifacts`(code / git / notion 3필드)를 기록한다.

**5. 결과 전달 및 전환**

1. 결과를 대표에게 전달
2. 다음 스킬 전환 정보에 따라:
   - 자동 → 해당 스킬 즉시 실행
   - 승인 필수 → 대표에게 실행 여부 확인

---

## 입력 (이전 스킬에서 받는 바통)

- ANL-001 분석 보고서 (스토리별 실현 가능성 + 복잡도)
- ANL-002 의존관계 맵 (컴포넌트 다이어그램 + 빌드 순서)
- ANL-003 리스크 목록 (리스크 매트릭스)
- ANL-004 기술 스택 결정서 (ADR + 평가 매트릭스)

## 출력 (다음 스킬에 넘기는 바통)

- DES-001 아키텍처 설계서 (C4 Model: Context → Container → Component)
- DES-002 API 명세서 (API Design First: 엔드포인트 → 스키마 → 에러 코드)
- DES-003 데이터 모델 — ERD (정규화 체크: 1NF/2NF/3NF)
- DES-004 와이어프레임 (Atomic Design: Atom → Page)
- DES-005 스토리보드 (사용자 흐름 다이어그램)
- DES-006 화면 명세서 (인터랙션 명세 + 모달/팝업 + 상태별 동작 + 유효성 검사)
- DES-007 상태 흐름도 (Mermaid stateDiagram)
- DES-008 파일/디렉토리 구조 (C4 Component에서 도출)
- DES-009 코드 정의서 — 시스템 Enum/코드 통합 정의

## 필요 권한

- 도구: Read, Write (docs/ 전용), Grep, Glob, AskUserQuestion, WebSearch
- Sub-Agent: docs-sub (문서 작성)

---

## 절차

### 1단계: 컨텍스트 수집

ANL 산출물과 PLN 산출물을 읽고 설계 범위를 파악한다:

- ANL-001 분석 보고서의 스토리별 복잡도와 불확실성
- ANL-002 의존관계 맵의 컴포넌트 구조와 빌드 순서
- ANL-003 리스크 목록의 높음/치명 리스크 (설계로 완화할 항목)
- ANL-004 기술 스택 결정서의 ADR (선택한 기술과 제약)
- PLN-001 요구사항 정의서의 Story Map과 수용 기준
- `src/CLAUDE.md` — 코딩 규칙

### 2단계: 아키텍처 설계 — C4 Model

3단계 아키텍처를 순서대로 설계한다.

#### 2-1. Context Diagram (시스템 경계)

시스템 전체를 하나의 박스로 놓고 외부 액터/시스템과의 관계를 정의한다.

```mermaid
graph TD
    User[대표 CEO] -->|사용| System[ClaudeManager v2]
    System -->|호출| Claude[Claude API]
    System -->|읽기/쓰기| Notion[Notion API]
```

- 시스템 안에 무엇이 있는지는 아직 열지 않는다
- **확인**: 모든 외부 액터와 시스템 경계가 PLN-001의 Activity에 대응하는가?

#### 2-2. Container Diagram (실행 단위)

시스템 내부를 독립 배포/실행 가능한 단위로 분해한다.

```mermaid
graph TD
    subgraph ClaudeManager
        FE[Web Frontend]
        BE[Backend Server]
        DB[(SQLite)]
        CLI[CLI Bridge]
    end
    FE -->|REST + WS| BE
    BE --> DB
    BE -->|프로세스 통신| CLI
    CLI -->|실행| CC[Claude Code]
```

각 Container에 대해:

| Container | 기술 | 역할 | 통신 방식 |
|-----------|------|------|----------|
| Web Frontend | (ANL-004 참조) | UI 제공 | REST + WebSocket |
| Backend Server | (ANL-004 참조) | 비즈니스 로직, API | REST + WebSocket |
| SQLite | SQLite | 상태 저장 | 파일 |
| CLI Bridge | Node/Python | Claude Code 연동 | 프로세스 |

- **확인**: ANL-002의 컴포넌트 다이어그램과 일치하는가?

#### 2-3. Component Diagram (모듈 구조)

각 Container 내부를 모듈/컴포넌트로 분해한다. ANL-002의 빌드 순서와 정합성을 확인한다.

```mermaid
graph TD
    subgraph Backend
        Router[API Router]
        AgentSvc[Agent Service]
        TaskSvc[Task Service]
        SkillSvc[Skill Service]
        WS[WebSocket Hub]
        Repo[Repository Layer]
    end
    Router --> AgentSvc
    Router --> TaskSvc
    Router --> SkillSvc
    AgentSvc --> Repo
    TaskSvc --> Repo
    WS --> AgentSvc
    Repo --> DB[(SQLite)]
```

각 Component에 대해:

| Component | 역할 | 의존 | 대응 Story |
|-----------|------|------|-----------|
| Agent Service | 에이전트 CRUD + 상태 관리 | Repository | FR-001, FR-002 |
| Task Service | 태스크 관리 | Repository, Agent | FR-003 |

- **확인**: 모든 Must 스토리가 최소 1개 Component에 매핑되는가?

### 3단계: API 설계 — API Design First

REST API를 설계한다. 코드 작성 전에 인터페이스를 확정하는 계약 우선(Contract First) 방식.

#### 3-1. 엔드포인트 목록

Story Map의 Task를 기준으로 리소스를 식별하고, CRUD를 매핑한다.

```markdown
| 리소스 | 메서드 | 경로 | 설명 | 대응 Story |
|--------|--------|------|------|-----------|
| Agent | GET | /api/agents | 에이전트 목록 | FR-001 |
| Agent | POST | /api/agents | 에이전트 생성 | FR-001 |
| Agent | GET | /api/agents/:id | 에이전트 상세 | FR-002 |
| Agent | PATCH | /api/agents/:id | 상태 변경 | FR-003 |
```

#### 3-2. 요청/응답 스키마

각 엔드포인트에 대해 JSON Schema를 정의한다.

```markdown
### POST /api/agents

**Request Body**:
| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| name | string | ✅ | 에이전트 이름 |
| skill | string | ✅ | 실행 스킬 이름 |
| config | object | | 추가 설정 |

**Response (201)**:
| 필드 | 타입 | 설명 |
|------|------|------|
| id | string | UUID |
| name | string | 에이전트 이름 |
| status | string | 상태 (created) |
| createdAt | string | ISO 8601 |

**에러 응답**:
| 코드 | 의미 | 조건 |
|------|------|------|
| 400 | Bad Request | 필수 필드 누락 |
| 409 | Conflict | 동일 이름 에이전트 존재 |
```

#### 3-3. WebSocket 이벤트 정의

실시간 통신이 필요한 이벤트를 정의한다.

```markdown
| 이벤트 | 방향 | 페이로드 | 설명 |
|--------|------|---------|------|
| agent:status | Server→Client | {id, status, progress} | 에이전트 상태 변경 |
| agent:log | Server→Client | {id, level, message} | 에이전트 로그 스트리밍 |
| agent:control | Client→Server | {id, action: pause/resume/cancel} | 제어 명령 |
```

### 4단계: 데이터 모델 설계 — ERD + 정규화 체크

#### 4-1. 엔티티 식별

API 스키마와 Story Map에서 엔티티를 도출한다.

```markdown
| 엔티티 | 설명 | 대응 Story |
|--------|------|-----------|
| Agent | 프로젝트 에이전트 | FR-001 |
| Task | 작업 단위 | FR-003 |
| Decision | 의사결정 요청/응답 | FR-005 |
```

#### 4-2. ERD (Mermaid)

```mermaid
erDiagram
    Agent ||--o{ Task : "has"
    Agent ||--o{ Decision : "requests"
    Task ||--o{ Log : "produces"
    Agent {
        string id PK
        string name
        string status
        string skill
        datetime created_at
    }
    Task {
        string id PK
        string agent_id FK
        string title
        string status
        datetime created_at
    }
```

#### 4-3. 정규화 체크

각 테이블을 1NF → 2NF → 3NF 순서로 점검한다.

| 정규형 | 규칙 | 점검 방법 |
|--------|------|----------|
| **1NF** | 모든 컬럼이 원자값 | 반복 그룹, 배열/JSON 컬럼이 있는가? 있으면 별도 테이블로 분리 |
| **2NF** | 부분 함수 종속 없음 | 복합 PK가 있을 때, PK 일부에만 종속하는 컬럼이 있는가? |
| **3NF** | 이행 함수 종속 없음 | 비PK 컬럼이 다른 비PK 컬럼에 종속하는가? 있으면 분리 |

**의도적 비정규화**: 성능을 위해 비정규화할 경우 근거와 대상을 명시한다.

```markdown
| 테이블 | 비정규화 컬럼 | 사유 | 동기화 전략 |
|--------|-------------|------|-----------|
| Agent | task_count | 매번 COUNT 쿼리 방지 | Task INSERT/DELETE 시 갱신 |
```

### 5단계: UI 설계 — Atomic Design + 와이어프레임

#### 5-1. 컴포넌트 계층 (Atomic Design)

UI 컴포넌트를 5계층으로 분해한다.

| 계층 | 설명 | 예시 |
|------|------|------|
| **Atom** | 더 이상 분해 불가한 최소 단위 | Button, Input, Badge, Icon |
| **Molecule** | Atom 조합, 단일 기능 | SearchBar (Input + Button), StatusBadge (Icon + Badge) |
| **Organism** | Molecule 조합, 독립 영역 | AgentCard, TaskList, ChatPanel |
| **Template** | Organism 배치, 레이아웃 | DashboardLayout, ChatLayout |
| **Page** | Template + 데이터 연결 | DashboardPage, AgentDetailPage |

```markdown
## 컴포넌트 맵

### Atoms
- Button (primary, secondary, danger, ghost)
- Input (text, search)
- Badge (status: running, paused, completed, error)
- Icon (agent, task, skill, alert)
- Spinner

### Molecules
- StatusBadge: Icon + Badge
- SearchBar: Input + Button
- MetricCard: Icon + Label + Value

### Organisms
- AgentCard: StatusBadge + MetricCard + Button (control)
- TaskList: TaskItem[] + SearchBar
- ChatPanel: MessageList + Input + Button

### Templates
- DashboardLayout: Header + Sidebar + MainContent
- DetailLayout: Header + BackButton + ContentArea

### Pages
- DashboardPage: DashboardLayout + AgentCard[] + MetricCard[]
- AgentDetailPage: DetailLayout + TaskList + ChatPanel
```

#### 5-2. 와이어프레임 (DES-004)

각 Page에 대해 ASCII 레이아웃과 영역별 컴포넌트를 정의한다.

```
┌─────────────────────────────────────────┐
│ Header: 로고 + 검색 + 알림              │
├────────┬────────────────────────────────┤
│        │ Main Content                   │
│ Side   │ ┌──────┐ ┌──────┐ ┌──────┐    │
│ bar    │ │Agent │ │Agent │ │Agent │    │
│        │ │Card  │ │Card  │ │Card  │    │
│ - 대시 │ └──────┘ └──────┘ └──────┘    │
│ - 에이 │                                │
│ - 설정 │ ┌─────────────────────────┐    │
│        │ │ Metrics Summary         │    │
│        │ └─────────────────────────┘    │
├────────┴────────────────────────────────┤
│ Footer: 상태바 + 비용                   │
└─────────────────────────────────────────┘
```

### 6단계: 스토리보드 — 사용자 흐름 다이어그램 (DES-005)

PLN-001의 Activity별로 사용자가 화면을 어떤 순서로 이동하는지 흐름을 정의한다.

```mermaid
graph LR
    A[대시보드] -->|에이전트 클릭| B[에이전트 상세]
    A -->|+ 새 에이전트| C[에이전트 생성 모달]
    C -->|생성 완료| B
    B -->|일시정지| D[확인 다이얼로그]
    D -->|확인| B
    B -->|로그 보기| E[로그 패널]
```

각 흐름에 대해:

```markdown
| 단계 | 화면 | 사용자 행동 | 시스템 반응 | 대응 Story |
|------|------|-----------|-----------|-----------|
| 1 | 대시보드 | 에이전트 카드 클릭 | 에이전트 상세 화면 이동 | FR-002 |
| 2 | 상세 | 일시정지 버튼 클릭 | 확인 다이얼로그 표시 | FR-003 |
```

### 7단계: 화면 명세서 — 인터랙션 + 상태별 동작 정의 (DES-006)

화면 명세서는 **"어느 화면에서 무엇을 조작하면 → 무엇이 뜨고 → 거기서 어떤 데이터를 보는가"**를 빠짐없이 적는 문서다.

**금지**: "정보를 표시한다", "상세를 보여준다" 같은 뭉뚱그린 서술. 표시되는 **필드명을 전부 나열**한다.

#### 7-0. GUI / CLI 용어 대응

화면 명세서의 구조는 GUI와 CLI가 같다. 용어만 대응시켜 동일한 표를 쓴다.

| 개념 | GUI | CLI |
|------|-----|-----|
| 화면 | 페이지 / 라우트 | 명령어 실행 결과 |
| 트리거 | 버튼·링크·탭·카드 클릭 | 명령어·옵션·인자 |
| 오버레이 | 모달·드로어·토스트 | 대화형 프롬프트·확인(y/N)·경고 블록 |
| 화면 이동 | 라우트 전환 | 후속 명령 안내 |
| 인라인 갱신 | 부분 리렌더 | 재조회 명령 |

각 화면마다 7-1 ~ 7-7을 **모두** 작성한다. 아래 예시는 "에이전트 상세" 화면 기준이다.

#### 7-1. 화면 기본 정보

| 항목 | 내용 |
|------|------|
| 화면 ID | SCR-AG03 |
| 화면명 | 에이전트 상세 |
| 경로/명령 | `/agents/:id` |
| 진입 경로 | SCR-AG02(목록) 카드 클릭, SCR-AG01(생성) 완료 후 |
| 대응 요구사항 | FR-007 |
| 인증 | 필요 |

#### 7-2. 화면 구성 요소 (영역별)

| 영역 | 컴포넌트 | 표시 데이터 | 데이터 출처 |
|------|---------|-----------|-----------|
| 헤더 | Breadcrumb + StatusBadge | 프로젝트명 > Agent명, 상태 | GET /api/agents/:id |
| 요약 카드 | InfoCard | ID, 이름, 유형, 스킬, 재시도 n/3, 생성일시, 수정일시 | 동일 |
| 액션 바 | Button×5 | 시작 / 일시정지 / 재개 / 취소 / 삭제 | — |
| Task 목록 | DataTable | ID(8자), 제목, 상태, 생성일시 | GET /api/tasks?agentId= |
| 푸터 | TransitionHint | 허용 상태 전이 목록 | 상태 머신(DES-007) |

#### 7-3. 인터랙션 명세 ★핵심

화면 안의 **모든** 조작 가능 요소를 1행 이상으로 적는다.
`결과 유형`은 6가지 중 하나로만 적는다: **화면이동 · 모달 · 드로어 · 토스트 · 인라인갱신 · 다운로드**

| 이벤트 ID | 트리거 | 사전 조건 | 결과 유형 | 이동/표시 대상 | 표시 데이터 | API | 실패 시 |
|-----------|--------|----------|----------|--------------|-----------|-----|--------|
| EVT-AG03-1 | Task 행 클릭 | — | 화면이동 | SCR-T03 Task 상세 | Task 7필드(ID·제목·Agent·상태·설명·생성·수정) | GET /api/tasks/:id | 토스트 "Task를 찾을 수 없습니다" |
| EVT-AG03-2 | [시작] 버튼 | status=created, 상위 프로젝트=running | 인라인갱신 | 상태 배지 + 액션 바 | 변경 후 상태, 변경 시각 | PATCH /api/agents/:id/status | 토스트 "프로젝트를 먼저 시작하세요" |
| EVT-AG03-3 | [삭제] 버튼 | Task 0건 | 모달 | MOD-01 삭제 확인 | Agent명, ID | — | — |
| EVT-AG03-4 | [삭제] 버튼 | Task 1건 이상 | 모달 | MOD-02 캐스케이드 경고 | Agent명, 삭제될 Task 건수, Task 제목 목록 | — | — |
| EVT-AG03-5 | [+ Task] 버튼 | status=running | 모달 | MOD-03 Task 생성 | 입력 폼(제목·설명) | POST /api/tasks | 인라인 필드 에러 |
| EVT-AG03-6 | [이력] 탭 | — | 드로어 | 상태 이력 패널 | 시각·From·To·변경자 (최근 20건) | GET /api/status-changes?entityId= | 빈 상태 "이력 없음" |

#### 7-4. 모달·팝업 명세

모달은 **독립 화면처럼** 별도 ID(MOD-xx)를 부여해 명세한다. 닫기 경로 없는 모달은 금지한다.

| 모달 ID | 제목 | 호출 이벤트 | 표시 데이터 | 입력 | 버튼 | 버튼별 결과 |
|---------|------|-----------|-----------|------|------|-----------|
| MOD-01 | Agent 삭제 | EVT-AG03-3 | Agent명, ID | — | 취소 / 삭제 | 취소→닫기 · 삭제→DELETE 후 SCR-AG02 이동 + 토스트 "삭제됨" |
| MOD-02 | 삭제 경고(캐스케이드) | EVT-AG03-4 | Agent명, Task n건, Task 제목 전체 | 확인 체크박스 | 취소 / 모두 삭제 | 체크 전 [모두 삭제] 비활성 · 삭제→SCR-AG02 이동 + 토스트 "Agent 1건, Task n건 삭제됨" |
| MOD-03 | Task 생성 | EVT-AG03-5 | Agent명(읽기전용) | 제목(필수), 설명(선택) | 취소 / 생성 | 생성→모달 닫기 + Task 목록 인라인갱신 + 토스트 "Task 생성됨" |

#### 7-5. 상태별 UI

| 상태 | 표시 요소 | 활성 버튼 | 비활성 버튼 (비활성 사유 툴팁) |
|------|----------|----------|---------------------------|
| created | StatusBadge(생성됨) | 시작, 삭제 | 일시정지·재개 ("시작 후 사용 가능") |
| running | StatusBadge(실행 중) + Spinner | 일시정지, 취소 | 시작·삭제 ("실행 중에는 삭제 불가") |
| paused | StatusBadge(대기 중) | 재개, 취소 | 시작·일시정지 |
| completed | StatusBadge(완료) | 삭제 | 시작·일시정지·재개 |
| error | StatusBadge(오류) + 에러 메시지 + 재시도 n/3 | 재시도, 삭제 | 일시정지·재개 |

#### 7-6. 유효성 검사

| 필드 | 규칙 | 검사 시점 | 에러 메시지 |
|------|------|----------|-----------|
| 에이전트 이름 | 1~50자, 공백 불가, 프로젝트 내 유일 | blur + 제출 | "이름을 입력해주세요 (1~50자)" / "이미 존재하는 이름입니다" |
| 스킬 선택 | 필수 | 제출 | "실행할 스킬을 선택해주세요" |

#### 7-7. 에러 · 빈 상태

| 유형 | 조건 | UI 표시 | 사용자 복구 경로 |
|------|------|---------|----------------|
| 빈 상태 | Task 0건 | 일러스트 + "아직 Task가 없습니다" | [+ Task] 버튼 → MOD-03 |
| API 타임아웃 | 10초 초과 | 토스트 "연결 실패" | [재시도] 버튼 |
| 404 | 대상 없음 | 전체 화면 "Agent를 찾을 수 없습니다" | [목록으로] → SCR-AG02 |
| 권한 없음 | 401/403 | 인라인 "권한 부족" | [로그인] → SCR-A01 |

#### 완성도 체크

아래를 모두 만족해야 화면 명세서가 완료된 것으로 본다.

| 점검 항목 | 확인 |
|----------|------|
| 화면의 모든 버튼·링크·명령이 7-3 표에 1행 이상 있는가 | |
| 모든 `결과 유형`이 6가지 중 하나로 적혔는가 | |
| `표시 데이터` 칸에 필드명이 구체적으로 나열되었는가 ("정보 표시" 금지) | |
| 모든 모달이 MOD-xx로 정의되고, 닫기/취소 경로가 있는가 | |
| 각 이벤트에 실패 시 동작이 적혔는가 | |
| DES-005 스토리보드의 모든 화살표가 7-3 표에 대응되는가 | |
| 빈 상태(empty state)가 정의되었는가 | |

### 8단계: 상태 흐름도 — Mermaid stateDiagram (DES-007)

시스템의 핵심 상태 머신을 Mermaid stateDiagram으로 정형화한다.

```mermaid
stateDiagram-v2
    [*] --> Created : 에이전트 생성
    Created --> Running : 시작
    Running --> Paused : 일시정지
    Running --> Completed : 작업 완료
    Running --> Error : 오류 발생
    Paused --> Running : 재개
    Paused --> Cancelled : 취소
    Error --> Running : 재시도
    Error --> Cancelled : 취소
    Completed --> [*]
    Cancelled --> [*]
```

각 전이에 대해:

| 현재 상태 | 이벤트 | 다음 상태 | 조건/가드 | 액션 |
|----------|--------|----------|----------|------|
| Created | 시작 | Running | 스킬 유효 | Sub-Agent 생성 |
| Running | 일시정지 | Paused | — | 프로세스 중단 |
| Running | 오류 발생 | Error | 재시도 횟수 < 3 | 에러 로그 기록 |
| Error | 재시도 | Running | 재시도 횟수 < 3 | 카운터 증가, 재실행 |
| Error | — | Cancelled | 재시도 횟수 ≥ 3 | 대표에게 에스컬레이션 |

### 9단계: 파일/디렉토리 구조 — C4 Component에서 도출 (DES-008)

2-3의 Component Diagram을 기반으로 파일/디렉토리 구조를 결정한다.

```markdown
src/
├── frontend/
│   ├── components/
│   │   ├── atoms/        ← Atomic Design Atom
│   │   ├── molecules/    ← Atomic Design Molecule
│   │   ├── organisms/    ← Atomic Design Organism
│   │   └── templates/    ← Atomic Design Template
│   ├── pages/            ← Atomic Design Page
│   ├── hooks/            ← 공용 훅
│   ├── stores/           ← 상태 관리
│   └── utils/            ← 유틸리티
├── backend/
│   ├── routes/           ← API Router
│   ├── services/         ← Business Logic (Component 단위)
│   ├── repositories/     ← Repository Layer
│   ├── models/           ← 데이터 모델/타입
│   ├── websocket/        ← WebSocket Hub
│   ├── migrations/       ← DB 마이그레이션
│   └── utils/            ← 유틸리티
```

Component → 디렉토리 매핑표:

| Component (C4) | 디렉토리 | 파일 패턴 |
|----------------|---------|----------|
| API Router | backend/routes/ | {resource}.routes.ts |
| Agent Service | backend/services/ | agent.service.ts |
| Repository Layer | backend/repositories/ | {entity}.repository.ts |
| WebSocket Hub | backend/websocket/ | hub.ts, handlers/ |
| Dashboard Page | frontend/pages/ | Dashboard.tsx |

### 10단계: 코드 정의서 — 시스템 Enum/코드 (DES-009)

시스템 전체에서 사용하는 Enum, 코드, 상수를 통합 정의한다.

```markdown
## 상태 코드

### AgentStatus
| 코드 | 값 | 설명 |
|------|------|------|
| CREATED | "created" | 생성됨, 실행 대기 |
| RUNNING | "running" | 실행 중 |
| PAUSED | "paused" | 일시 정지 |
| COMPLETED | "completed" | 정상 완료 |
| ERROR | "error" | 오류 발생 |
| CANCELLED | "cancelled" | 취소됨 |

### DecisionLevel
| 코드 | 값 | 설명 |
|------|------|------|
| HIGH | "high" | 대표 승인 필수 |
| MEDIUM | "medium" | 알림 후 자동 진행 |
| LOW | "low" | 자율 판단 |

## 에러 코드
| 코드 | HTTP | 설명 |
|------|------|------|
| AGENT_NOT_FOUND | 404 | 에이전트 없음 |
| AGENT_CONFLICT | 409 | 이름 중복 |
| INVALID_TRANSITION | 422 | 불가능한 상태 전이 |
```

### 11단계: 다중 관점 자체 검토

설계 결과를 3가지 관점에서 자체 검토한다.

#### 아키텍처 관점

| 점검 항목 | 확인 |
|----------|------|
| C4 3단계가 일관적인가? (Context→Container→Component 추적 가능) | |
| 모든 Must 스토리가 Component에 매핑되는가? | |
| ANL-003의 높음/치명 리스크에 대한 대응이 설계에 반영되었는가? | |
| 레이어 간 의존 방향이 단방향인가? (순환 의존 없음) | |
| ADR 결정 사항과 설계가 일치하는가? | |

#### UI/UX 관점

| 점검 항목 | 확인 |
|----------|------|
| 스토리보드의 모든 화면 전이에 대응하는 와이어프레임이 있는가? | |
| 화면 명세서에 에러 상태와 빈 상태(empty state)가 정의되었는가? | |
| 모든 버튼·명령이 인터랙션 명세(7-3)에 1행 이상 있는가? | |
| 모든 모달·팝업이 MOD-xx로 정의되고 닫기 경로가 있는가? | |
| 인터랙션의 `표시 데이터`가 필드명 단위로 적혔는가? | |
| Atomic Design 계층이 재사용 가능한 단위로 나뉘어 있는가? | |
| 접근성 고려 (키보드 네비게이션, 색상 대비) 항목이 있는가? | |

#### 데이터 관점

| 점검 항목 | 확인 |
|----------|------|
| ERD가 3NF를 만족하는가? (의도적 비정규화는 근거 명시) | |
| 모든 API 엔드포인트의 요청/응답이 ERD 엔티티와 대응하는가? | |
| 상태 흐름도의 전이가 DB에서 무결성을 보장할 수 있는가? | |
| 마이그레이션 전략이 필요한 스키마 변경이 식별되었는가? | |

### 12단계: 설계 문서 작성 및 보고

docs-sub에게 설계 문서 작성을 위임하고, 대표에게 최종 보고한다.

---

## 산출물 상세 형식

### DES-001 아키텍처 설계서

```markdown
# 아키텍처 설계서

## C4 Level 1: Context Diagram
(시스템 경계 + 외부 액터)

## C4 Level 2: Container Diagram
(실행 단위 + 통신 방식)

| Container | 기술 | 역할 | 통신 |
|-----------|------|------|------|

## C4 Level 3: Component Diagram
(Container별 내부 모듈)

| Component | 역할 | 의존 | 대응 Story |
|-----------|------|------|-----------|

## 레이어 규칙
(의존 방향, 금지 사항)

## 리스크 대응 설계
(ANL-003 높음/치명 리스크에 대한 설계적 대응)
```

### DES-003 데이터 모델

```markdown
# 데이터 모델

## ERD
(Mermaid erDiagram)

## 테이블 정의
### {테이블명}
| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|

## 정규화 체크 결과
| 테이블 | 1NF | 2NF | 3NF | 비고 |
|--------|-----|-----|-----|------|

## 의도적 비정규화
| 테이블 | 컬럼 | 사유 | 동기화 |
|--------|------|------|--------|

## 인덱스 전략
| 테이블 | 인덱스 | 컬럼 | 사유 |
|--------|--------|------|------|
```

---

## 의사결정 포인트

- 아키텍처 설계 확정 (C4 구조): 대표 승인 필수 (높음)
- UI/UX 설계 확정 (와이어프레임 + 스토리보드): 대표 승인 필수 (높음)
- 의도적 비정규화: 대표 확인 (보통)

## 체크포인트

- 아키텍처 설계(C4) + API 명세 완료 후 중간 보고
- 와이어프레임 + 스토리보드 완성 후 검토 요청
- 다중 관점 검토 후 최종 보고

## 제약 사항

- 분석 단계에서 식별한 리스크에 대한 대응책 포함
- 설계는 반드시 대표 승인 후 개발 진행 (의사결정 등급: 높음)
- 코딩 규칙(src/CLAUDE.md)을 준수하는 설계
- 변경 없는 산출물은 이전 Phase 것 유지
- API 설계는 코드 작성 전에 인터페이스를 확정한다 (Contract First)
- ERD는 최소 3NF 점검, 비정규화 시 근거 명시
- Mermaid 다이어그램을 사용하여 시각화한다

## 완료 조건

- 대표 승인 (아키텍처 + UI/UX)
- C4 3단계 다이어그램 완성
- 모든 API 엔드포인트에 요청/응답 스키마 정의
- ERD 정규화 체크 완료
- 상태 흐름도에 모든 전이 조건/가드 정의
- 다중 관점 자체 검토 완료

## 실패/에스컬레이션 조건

- 분석 리스크 대응 불가 시 대표에게 에스컬레이션
- 기술 스택 제약으로 설계 불가 시 보고
- C4 Component와 Story 매핑에 누락이 있을 경우 analyze 회귀 제안

## 완료 후 액션

1. 완료 요약 (산출물 목록 + C4 구조 개요 + 주요 설계 결정)
2. docs/00-progress.md 갱신
3. 스킬 전환: design → develop은 **자동**

## 다음 스킬

- develop
