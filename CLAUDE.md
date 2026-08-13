# ClaudeManager v2

1인 CEO를 위한 Skill 기반 멀티 에이전트 오케스트레이션 시스템.

## 역할 계층

```
대표 (CEO) — 유일한 사용자
  └─ Main — 디스패처 (요구사항 수신, 스킬 탐색, Agent 생성·위임)
       └─ Agent — 프로젝트 실행 책임자 (Sub-Agent 관리, 대표에게 직접 보고)
            └─ Sub-Agent — 작업 수행자 (실무 수행, 산출물 생성)
```

## 그래프 규칙

1. **Main은 생성·위임 후 실무에 개입하지 않는다**
2. **Agent가 대표에게 직접 보고·의사결정 요청한다** (Main 경유 안 함)
3. **Sub-Agent는 Agent에게만 보고한다** (대표 직접 접근 불가)
4. **Sub-Agent 간 수평 통신은 파일 기반이다** (.orchestrator/handoff/, feedback/)
5. **제어(일시정지/재개/취소)는 대시보드를 경유한다**

## 의사결정 등급

| 등급 | 동작 | 예시 |
|------|------|------|
| 높음 | 대표 승인 필수, 승인 전까지 대기 | 아키텍처 변경, 배포, 외부 API 연동 |
| 보통 | 대표에게 알림, 타임아웃 후 자동 진행 | 라이브러리 선택, 테스트 전략 |
| 낮음 | 자율 판단, 결과만 기록 | 변수명, 파일 구조, 코드 스타일 |

## 보고 형식

모든 Agent/Sub-Agent는 결과를 아래 형식으로 보고한다:

```
## 요약
(1-3줄 핵심 요약)

## 수행 내용
(무엇을 했는지)

## 산출물
(생성된 파일/문서 목록)

## 미해결 사항
(남은 이슈, 필요한 의사결정)
```

## 개발 방법론

반복적 점진개발 + 칸반. Phase 단위로 기획→분석→설계→개발→테스트→배포→운영 전체 사이클을 반복한다.
- 주요 단계 WIP = 1 (한 단계 끝내야 다음 단계)
- 독립 Task 병렬 허용 (test-sub + review-sub 동시 가능)
- 운영 피드백은 다음 Phase 기획의 입력

## 스킬 (SDLC 7단계)

| 스킬 | 단계 | 핵심 |
|------|------|------|
| plan | 기획 | 요구사항 정형화, Phase 범위 확정 |
| analyze | 분석 | 기술 검토, 의존관계, 리스크 |
| design | 설계 | 아키텍처, API, 화면 명세서 |
| develop | 개발 | 코딩, 단위 테스트, PR 생성 |
| test | 테스트 | 리뷰, 통합 테스트, PR 머지 |
| deploy | 배포 | 빌드, 배포 (실행 시 대표 승인) |
| operate | 운영 | 버그 수정, 다음 Phase 피드백 |

## 산출물 코드 체계

PLN(기획), ANL(분석), DES(설계), DEV(개발), TST(테스트), DPL(배포), OPS(운영)
요구사항: FR(기능), NFR(비기능), UIR(UI), DAT(데이터), INT(인터페이스)
테스트: TC-UT(단위), TC-IT(통합), TC-ST(시나리오), TC-PT(성능), TC-SE(보안), TC-UA(인수)

## 기준 원본 정책

- Notion: 대표 검토/승인 원본
- Git (docs/): 에이전트 실행 원본
- 충돌 시 Notion(승인본) 우선

## 에이전트 구성

| 에이전트 | 모델 | 역할 |
|----------|------|------|
| main | opus | 디스패처 (스킬 탐색, Agent 생성·위임) |
| project-agent | opus | 프로젝트 실행 책임자 (Sub-Agent 관리, 대표 보고) |
| dev-sub | sonnet | 코딩 실무 (소스코드, 단위 테스트) |
| test-sub | sonnet | 테스트 실행 (코드 수정 불가) |
| review-sub | opus | 코드 리뷰 (완전 읽기 전용) |
| docs-sub | sonnet | 문서 작성 (docs/ 전용) |

## 스킬 전환 모드

mode: auto
- plan → analyze: 승인 필수
- analyze → design: 자동
- design → develop: 자동
- develop → test: 자동
- test → deploy: 승인 필수
- deploy → operate: 자동

자동 모드에서도 스킬 내부의 의사결정 등급 '높음' 항목은 별도 대표 승인 필요.

## 디렉토리 구조

```
.claude/agents/    — 에이전트 정의 (하네스 6개)
.claude/skills/    — 스킬 정의 (SDLC 7단계)
.orchestrator/     — 에이전트 간 통신
  handoff/         — Sub-Agent 간 작업 인수인계
  feedback/        — Sub-Agent 간 피드백
  status/          — Agent 상태 파일
  control/         — 제어 신호 (일시정지/재개/취소)
  learnings.jsonl  — 프로젝트 학습 기록
docs/              — 산출물 문서
  00-progress.md   — Phase 진행 상황 추적
  requirements/    — PLN: 요구사항, 용어 사전, 코드 체계
  plans/           — PLN: Phase 계획서
  analysis/        — ANL: 분석 보고서, 기술 스택 결정서
  design/          — DES: 설계서
    api/           —   API 명세서
    data/          —   데이터 모델 (ERD)
    ui/            —   와이어프레임, 스토리보드, 화면 명세서, 상태 흐름도
  test-reports/    — TST: 테스트 결과
    cases/         —   테스트 케이스 문서
    performance/   —   성능 테스트
    security/      —   보안 검토서
    acceptance/    —   인수 테스트 (UAT)
  deploy/          — DPL: 배포 체크리스트, 환경 설정 가이드
  releases/        — DPL: 릴리스 노트
  bug-reports/     — OPS: 버그 리포트
  operations/      — OPS: 운영 매뉴얼
  feedback/        — OPS: 다음 Phase 피드백
src/frontend/      — 웹 UI (대시보드)
src/backend/       — 백엔드 서버
  migrations/      — DB 마이그레이션 스크립트
tests/             — 테스트
  unit/            — 단위 테스트
```
