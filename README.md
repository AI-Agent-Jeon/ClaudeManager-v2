# ClaudeManager v2

1인 CEO를 위한 Skill 기반 멀티 에이전트 오케스트레이션 시스템.

Claude Code의 에이전트와 스킬을 활용하여 소프트웨어 개발 전 과정(기획→배포)을 체계적으로 수행한다.

## 아키텍처

```
대표 (CEO) — 유일한 사용자
  └─ Main — 디스패처 (요구사항 수신, 스킬 탐색, Agent 생성·위임)
       └─ Agent — 프로젝트 실행 책임자 (Sub-Agent 관리, 대표에게 직접 보고)
            └─ Sub-Agent — 작업 수행자 (실무 수행, 산출물 생성)
```

### 에이전트 구성

| 에이전트 | 모델 | 역할 |
|----------|------|------|
| main | opus | 디스패처 — 스킬 탐색, Agent 생성·위임 |
| project-agent | opus | 프로젝트 실행 책임자 — Sub-Agent 관리, 대표 보고 |
| dev-sub | sonnet | 코딩 실무 — 소스코드, 단위 테스트 |
| test-sub | sonnet | 테스트 실행 — 결과 보고 (코드 수정 불가) |
| review-sub | opus | 코드 리뷰 — 보안 검토 (완전 읽기 전용) |
| docs-sub | sonnet | 문서 작성 — docs/ 전용 |

### 그래프 규칙

- Main은 생성·위임 후 실무에 개입하지 않는다
- Agent가 대표에게 직접 보고한다 (Main 경유 안 함)
- Sub-Agent는 Agent에게만 보고한다
- Sub-Agent 간 수평 통신은 파일 기반이다 (`.orchestrator/`)

## SDLC 7단계 스킬

각 스킬은 소프트웨어 개발 방법론이 내장되어 있으며, "기획해줘", "개발해줘" 등 자연어로 실행된다.

| 스킬 | 버전 | 핵심 방법론 | 트리거 예시 |
|------|------|-----------|-----------|
| **plan** | v3.0 | 강제 질문(gstack) + User Story Mapping + INVEST + Given-When-Then + MoSCoW | "기획해줘", "Phase 계획" |
| **analyze** | v2.0 | T-shirt sizing + 평가 매트릭스 + ADR + 리스크 매트릭스 | "분석해줘", "기술 검토" |
| **design** | v2.0 | C4 Model + API Design First + ERD 정규화 + Atomic Design + 상태 머신 | "설계해줘", "아키텍처" |
| **develop** | v2.0 | TDD(Red-Green-Refactor) + SOLID/DRY/KISS + Conventional Commits | "개발해줘", "구현해줘" |
| **test** | v2.0 | 테스트 피라미드 + BVA/EP + OWASP Top 10 + 결함 심각도 분류 | "테스트해줘", "리뷰해줘" |
| **deploy** | v2.0 | Pre-flight 체크리스트 + Smoke Test + 롤백 기준 + Keep a Changelog | "배포해줘", "릴리스" |
| **operate** | v2.0 | 5 Whys + 인시던트 P0~P3 + Post-mortem + KPT 회고 | "버그", "수정해줘" |

### 스킬 전환

```
plan ──승인필수──→ analyze ──자동──→ design ──자동──→ develop ──자동──→ test ──승인필수──→ deploy ──자동──→ operate
  ↑                                                                                                        │
  └──────────────────────────────────── 다음 Phase 피드백 ──────────────────────────────────────────────────────┘
```

## 의사결정 등급

| 등급 | 동작 | 예시 |
|------|------|------|
| 높음 | 대표 승인 필수, 승인 전까지 대기 | 아키텍처 변경, 배포, 외부 API 연동 |
| 보통 | 대표에게 알림, 타임아웃 후 자동 진행 | 라이브러리 선택, 테스트 전략 |
| 낮음 | 자율 판단, 결과만 기록 | 변수명, 파일 구조, 코드 스타일 |

## 산출물 코드 체계

각 스킬은 코드가 부여된 산출물을 생성한다:

| 접두사 | 단계 | 산출물 예시 |
|--------|------|-----------|
| PLN | 기획 | PLN-001 요구사항 정의서, PLN-002 Phase 계획서 |
| ANL | 분석 | ANL-001 분석 보고서, ANL-004 기술 스택 결정서(ADR) |
| DES | 설계 | DES-001 아키텍처(C4), DES-002 API 명세서 |
| DEV | 개발 | DEV-001 소스코드, DEV-003 PR |
| TST | 테스트 | TST-001 테스트 케이스, TST-006 보안 검토서(OWASP) |
| DPL | 배포 | DPL-001 배포 체크리스트, DPL-003 릴리스 노트 |
| OPS | 운영 | OPS-002 버그 리포트(5 Whys), OPS-005 Phase 피드백(KPT) |

## 디렉토리 구조

```
ClaudeManager/
├── .claude/
│   ├── agents/          # 에이전트 정의 (하네스 6개)
│   └── skills/          # 스킬 정의 (SDLC 7단계)
│       ├── plan/        #   기획 (v3.0)
│       ├── analyze/     #   분석 (v2.0)
│       ├── design/      #   설계 (v2.0)
│       ├── develop/     #   개발 (v2.0)
│       ├── test/        #   테스트 (v2.0)
│       ├── deploy/      #   배포 (v2.0)
│       └── operate/     #   운영 (v2.0)
├── .orchestrator/       # 에이전트 간 통신
│   ├── handoff/         #   Sub-Agent 간 작업 인수인계
│   ├── feedback/        #   Sub-Agent 간 피드백
│   ├── status/          #   Agent 상태 파일
│   ├── control/         #   제어 신호
│   └── learnings.jsonl  #   프로젝트 학습 기록
├── docs/                # 산출물 문서
│   ├── 00-progress.md   #   Phase 진행 상황 추적
│   ├── requirements/    #   PLN: 요구사항, 용어 사전
│   ├── plans/           #   PLN: Phase 계획서
│   ├── analysis/        #   ANL: 분석 보고서, 기술 스택 결정서
│   ├── design/          #   DES: 설계서 (api/, data/, ui/)
│   ├── test-reports/    #   TST: 테스트 결과 (cases/, performance/, security/)
│   ├── deploy/          #   DPL: 배포 체크리스트
│   ├── releases/        #   DPL: 릴리스 노트
│   ├── bug-reports/     #   OPS: 버그 리포트
│   ├── operations/      #   OPS: 운영 매뉴얼
│   └── feedback/        #   OPS: 다음 Phase 피드백
├── src/
│   ├── frontend/        # 웹 UI (대시보드)
│   └── backend/         # 백엔드 서버
└── tests/
    └── unit/            # 단위 테스트
```

## 사용법

Claude Code에서 자연어로 스킬을 실행한다:

```
# Phase 기획 시작
"기획해줘" 또는 "Phase 1 계획 세워줘"

# 요구사항 분석
"분석해줘"

# 시스템 설계
"설계해줘" 또는 "아키텍처 설계해줘"

# 기능 개발
"개발해줘" 또는 "구현해줘"

# 테스트 및 리뷰
"테스트해줘" 또는 "코드 리뷰해줘"

# 배포
"배포해줘"

# 운영 중 버그 수정
"버그 수정해줘" 또는 "에러 고쳐줘"
```

## Notion 문서

프로젝트의 기준 원본 문서는 Notion에서 관리된다.

| 문서 | 설명 |
|------|------|
| [ClaudeManager 메인](https://www.notion.so/ClaudeManager-3b9d066504ec81d390f2db532eadc287) | 프로젝트 메인 페이지 (SDLC 7단계 하위 구조) |
| [요구사항 정의서](https://www.notion.so/ClaudeManager-v2-3b9d066504ec815e8e69ff96f2fd3ad8) | 15장 구성, 기능 요구사항, 시나리오, 로드맵 |

**기준 원본 정책**: Notion = 대표 검토/승인 원본, Git(docs/) = 에이전트 실행 원본. 충돌 시 Notion 우선.

## 기술 결정 (확정)

| 항목 | 결정 | 근거 |
|------|------|------|
| 상태 저장소 | SQLite | 1인 사용, 로컬 실행, 설치 불필요 |
| Web-CLI 통신 | REST + WebSocket | REST(CRUD) + WS(실시간 스트리밍) |
| MVP 범위 | 웹앱(로컬 백엔드 + 웹 UI) + CLI | MacBook 로컬, 단일 사용자 |
| 프론트엔드 | 미결정 | analyze 스킬에서 ADR로 결정 예정 |
| 백엔드 | 미결정 | analyze 스킬에서 ADR로 결정 예정 |

## 현재 상태

Phase 1 "기반 구축" 시작 전. 스킬-에이전트 구조 준비 완료.

진행 상황은 [`docs/00-progress.md`](docs/00-progress.md)에서 확인.

## 개발 방법론

반복적 점진개발 + 칸반. Phase 단위로 기획→분석→설계→개발→테스트→배포→운영 전체 사이클을 반복한다.

- 주요 단계 WIP = 1 (한 단계 끝내야 다음 단계)
- 독립 Task 병렬 허용 (test-sub + review-sub 동시 가능)
- 운영 피드백은 다음 Phase 기획의 입력
