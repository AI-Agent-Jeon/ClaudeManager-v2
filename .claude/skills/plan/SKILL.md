---
name: plan
description: >
  Phase를 기획한다. "기획해줘", "요구사항 정리", "Phase 계획",
  "뭐부터 해야 해", "우선순위" 등의 요청 시 사용한다.
  User Story Mapping + INVEST/Given-When-Then 방법론 기반.
version: 2.0
triggers:
  - 기획
  - 요구사항
  - 요구 사항
  - 범위
  - Phase
  - 계획
  - 시작
  - 뭐부터
---

> **이 스킬은 project-agent가 실행합니다.**

## 디스패치

### 사전 점검

1. 이전 Phase 피드백 확인: `ls docs/feedback/ 2>/dev/null`
2. 현재 브랜치 확인: `git branch --show-current`
3. 미커밋 변경사항 확인: `git status --short`

누락 산출물이 있으면 이전 스킬 회귀를 제안한다.

### 위임

사전 점검 통과 시, project-agent를 생성한다:
- subagent_type: `project-agent`
- 전달: 스킬 `plan`, 경로 `.claude/skills/plan/SKILL.md`
- Notion 요구사항이 있으면 내용을 프롬프트에 포함하여 전달

### 완료 후

project-agent 완료 시:
1. 결과를 대표에게 전달
2. 다음 스킬 전환 정보에 따라:
   - 자동 → 해당 스킬 즉시 실행
   - 승인 필수 → 대표에게 실행 여부 확인

---

## 입력 (이전 스킬에서 받는 바통)

- 대표 요청 (신규 Phase)
- OPS-005 다음 Phase 피드백 (후속 Phase)

## 출력 (다음 스킬에 넘기는 바통)

- PLN-001 요구사항 정의서 (Story Map + 요구사항 목록 + 수용 기준)
- PLN-002 Phase 계획서 (Walking Skeleton + 작업 목록)
- PLN-003 우선순위 목록 (MoSCoW 분류)
- PLN-004 용어 사전
- PLN-005 프로젝트 코드 체계

## 필요 권한

- 도구: Read, Write, AskUserQuestion
- Sub-Agent: 없음

## 절차

### 1단계: 목표 정의

대표에게 아래 5가지를 확인한다 (AskUserQuestion):

| 질문 | 목적 |
|------|------|
| 이 Phase에서 해결할 핵심 문제는? | 목표 명확화 |
| 주요 사용자는 누구이며 어떤 상황에서 쓰는가? | 사용자 컨텍스트 |
| 반드시 포함해야 할 핵심 기능은? | Must-have 식별 |
| 절대 이번에 하지 않을 것은? | 범위 경계 설정 |
| 시간/리소스 제약이 있는가? | Appetite 확인 |

기존 요구사항 정의서(docs/requirements/)와 이전 Phase 피드백(docs/feedback/)이 있으면 먼저 읽고, 이미 답이 있는 항목은 건너뛴다.

### 2단계: User Story Mapping

사용자의 목표를 **Activity → Task → Story** 계층으로 분해한다.

```
Activity (대분류 — 사용자의 큰 목표)
├── Task (중분류 — 목표 달성을 위한 단계)
│   ├── Story (소분류 — 구현 가능한 단위 기능)
│   └── Story
└── Task
    ├── Story
    └── Story
```

**예시**:
```
[에이전트 관리] ← Activity
├── [에이전트 생성] ← Task
│   ├── 대표로서 프로젝트 에이전트를 생성하여 작업을 위임한다 ← Story
│   └── 대표로서 에이전트 설정을 지정하여 역할을 제한한다 ← Story
└── [에이전트 모니터링] ← Task
    ├── 대표로서 에이전트 상태를 확인하여 진행을 파악한다 ← Story
    └── 대표로서 에이전트를 일시정지하여 비용을 제어한다 ← Story
```

### 3단계: 스토리 작성 — INVEST 기준

각 Story를 아래 형식으로 작성한다:

```
### [요구사항 코드] 스토리 제목

- **스토리**: [역할]로서 [기능]을 하여 [이유/가치]를 얻는다
- **분류**: FR | NFR | UIR | DAT | INT
- **우선순위**: Must | Should | Could | Won't (이번 Phase)

#### 수용 기준

- [ ] Given [사전 조건] When [행동] Then [기대 결과]
- [ ] Given ... When ... Then ...
```

**요구사항 코드 부여 규칙**:
- FR-001, FR-002... (기능 요구사항)
- NFR-001... (비기능: 성능, 보안, 가용성)
- UIR-001... (UI/UX)
- DAT-001... (데이터)
- INT-001... (인터페이스/연동)

**INVEST 검증 체크리스트** (스토리마다 확인):

| 기준 | 질문 | 미충족 시 |
|------|------|----------|
| **I**ndependent | 다른 스토리 없이 독립 구현 가능한가? | 의존 스토리와 병합 또는 순서 명시 |
| **N**egotiable | 구현 방법이 열려 있는가? | "~방식으로"를 제거하고 목적만 남김 |
| **V**aluable | 사용자에게 가치를 주는가? | 기술 태스크면 가치 스토리에 포함 |
| **E**stimable | 규모를 판단할 수 있는가? | 불확실하면 spike(탐색) 스토리로 분리 |
| **S**mall | 한 Phase 내에서 완료 가능한가? | 더 작은 스토리로 분할 |
| **T**estable | 수용 기준으로 통과/실패 판단 가능한가? | Given-When-Then 재작성 |

### 4단계: 우선순위 결정 — MoSCoW

Story Map에서 각 스토리를 세로축 우선순위로 배치한다:

| 등급 | 기준 | 행동 |
|------|------|------|
| **Must** | 이것 없으면 Phase가 무의미 | 반드시 포함 |
| **Should** | 중요하지만 우회 가능 | 가능하면 포함 |
| **Could** | 있으면 좋음 | 여유 시 포함 |
| **Won't** | 이번엔 안 함 | 명시적으로 제외, 다음 Phase 후보 |

**Walking Skeleton 식별**: Must 스토리 중에서도 모든 Activity를 관통하는 최소 흐름을 찾는다. 이것이 Phase의 핵심 구현 범위가 된다.

```
Activity A ──── Must Story ────┐
Activity B ──── Must Story ────┤ Walking Skeleton
Activity C ──── Must Story ────┘ (최소 동작 흐름)
```

### 5단계: Phase 범위 확정

1. Walking Skeleton = Phase의 Must 범위
2. Should 스토리 = 시간 여유에 따라 포함 여부 결정
3. Could/Won't = 명시적으로 제외 기록
4. **대표에게 범위 승인 요청** (의사결정 등급: 높음)

### 6단계: Phase 계획서 작성

PLN-002에 포함할 내용:
- Phase 목표 (1-2문장)
- Walking Skeleton 정의
- 작업 목록 (Story 단위, 의존 순서 포함)
- 스킬별 예상 산출물
- 미결정 사항 목록
- Phase 완료 조건

### 7단계: 산출물 정리 및 보고

PLN-001~005를 docs/에 저장하고 대표에게 최종 보고한다.

## 산출물 상세 형식

### PLN-001 요구사항 정의서

```markdown
# 요구사항 정의서 v{N}

## 프로젝트 목표
## Story Map

### [Activity 1]
#### [Task 1.1]
- FR-001: 스토리 ...
  - Given ... When ... Then ...
#### [Task 1.2]
- FR-002: ...

## 요구사항 요약표

| 코드 | 분류 | 스토리 | 우선순위 | INVEST |
|------|------|--------|----------|--------|
| FR-001 | FR | ... | Must | ✅ |

## 변경 이력
```

### PLN-003 우선순위 목록

```markdown
# 우선순위 목록

## Walking Skeleton (Must)
- FR-001, FR-003, UIR-001 ...

## Should
- FR-005, NFR-002 ...

## Could
- FR-008 ...

## Won't (이번 Phase 제외)
- FR-010 ... → Phase N+1 후보
```

## 의사결정 포인트

- Phase 범위 확정 (Walking Skeleton): 대표 승인 필수 (높음)
- 우선순위 결정 (MoSCoW 배치): 대표 승인 필수 (높음)
- Won't 항목 확정: 대표 확인 (보통)

## 체크포인트

- Story Map 초안 완성 후 중간 보고 (Activity-Task 구조 + 스토리 목록)
- Phase 계획서 초안 작성 후 검토 요청

## 제약 사항

- Phase 계획은 반드시 대표 승인 후 실행 (의사결정 등급: 높음)
- 미결정 사항은 명시적으로 표시
- 이전 Phase 운영 피드백이 있으면 반드시 반영
- 기존 요구사항을 반복 작성하지 않고 버전/변경 이력으로 연결
- 모든 Must 스토리에 Given-When-Then 수용 기준 필수 (Should는 권장, Could는 선택)
- 스토리가 INVEST 기준을 통과하지 못하면 수정 후 진행

## 완료 조건

- 대표 승인
- 모든 Must 스토리에 수용 기준(Given-When-Then) 포함
- INVEST 기준 검증 완료
- Walking Skeleton 식별 완료

## 실패/에스컬레이션 조건

- 요구사항 간 상충 발견 시 대표에게 보고
- 기술적 실현 불가 판단 시 대표에게 에스컬레이션
- Must 스토리가 INVEST-Small 기준 미충족 시 대표와 분할 논의

## 완료 후 액션

1. 완료 요약 (산출물 목록 + Story Map 개요)
2. docs/00-progress.md 갱신
3. 스킬 전환: plan → analyze는 **승인 필수**

## 다음 스킬

- analyze
