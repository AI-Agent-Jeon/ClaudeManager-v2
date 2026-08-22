---
name: test
description: >
  코드를 테스트하고 리뷰한다. "테스트해줘", "검증해줘", "리뷰해줘",
  "코드 확인해줘", "이 코드 괜찮아?" 등의 요청 시 사용한다.
version: 1.0
triggers:
  - 테스트
  - 검증
  - 리뷰
  - 코드 확인
  - 괜찮아
  - 점검
---

> **이 스킬은 project-agent가 실행합니다.**

## 디스패치

### 사전 점검

1. DEV-001~005 존재, PR 생성 확인:
   - `ls src/ tests/unit/ 2>/dev/null`
   - `gh pr list --state open --limit 5 2>/dev/null`
2. 현재 브랜치 확인: `git branch --show-current`

누락 산출물이 있으면 develop 스킬 회귀를 제안한다.

### 위임

사전 점검 통과 시, project-agent를 생성한다:
- subagent_type: `project-agent`
- 전달: 스킬 `test`, 경로 `.claude/skills/test/SKILL.md`

### 완료 후

project-agent 완료 시:
1. 결과를 대표에게 전달
2. 다음 스킬 전환 정보에 따라:
   - 자동 → 해당 스킬 즉시 실행
   - 승인 필수 → 대표에게 실행 여부 확인

---

## 입력 (이전 스킬에서 받는 바통)

- DEV-001 소스코드
- DEV-002 단위 테스트 코드
- DEV-003 PR (생성 상태)
- DEV-004 변경 이력 (CHANGELOG)
- DEV-005 DB 마이그레이션 스크립트
- DES-005 스토리보드 (인수 테스트용)
- PLN-001 요구사항 정의서 (시나리오 테스트용)

## 출력 (다음 스킬에 넘기는 바통)

- TST-001 테스트 케이스 문서
- TST-002 테스트 결과 리포트
- TST-003 코드 리뷰 코멘트
- TST-004 버그 목록
- TST-005 성능 테스트 결과
- TST-006 보안 검토서
- TST-007 인수 테스트 시나리오 (UAT)
- DEV-003 PR 머지 (테스트 통과 시 최종 게이트)

## 필요 권한

- 도구: Read, Write, Bash, Grep, Glob
- Sub-Agent: test-sub (테스트 실행), review-sub (코드 리뷰), dev-sub (버그 수정)

## 절차

1. PLN-001의 수용 기준(Given-When-Then)과 설계서 읽기
2. 테스트 케이스 작성: 수용 기준의 Given-When-Then을 테스트 케이스로 변환
   - Given → 테스트 사전 조건 (setup)
   - When → 테스트 동작 (action)
   - Then → 검증 (assertion)
3. 통합 테스트 실행: test-sub에게 위임
4. 시나리오 테스트 실행: Story Map의 Activity 흐름 기반 시나리오 test-sub에게 위임
5. 코드 리뷰: review-sub에게 위임 (test-sub과 병렬 가능)
   - 정확성, 보안, 코딩 규칙, 유지보수성 검토
   - 발견사항을 심각도별 분류 (치명/높음/보통/낮음)
6. 성능 테스트: test-sub에게 위임 (변경 유형에 따라 조건부)
7. 보안 검토: review-sub에게 위임 (변경 유형에 따라 조건부)
8. 인수 테스트: 스토리보드 흐름 검증
9. 버그 발견 시 dev-sub에게 수정 요청 (피드백 루프)
10. 전체 통과 시 PR 머지
11. 결과 보고

## 의사결정 포인트

- 치명/높음 버그 발견 시: 수정 후 재테스트 필수
- 성능/보안 기준 미달 시: 대표에게 보고 (보통)

## 체크포인트

- 통합 테스트 완료 후 중간 보고
- 코드 리뷰 완료 후 결과 공유

## 제약 사항

- review-sub는 코드를 직접 수정하지 않는다 (리뷰만)
- test-sub, review-sub는 Write 불가 — 결과는 Agent가 문서화
- 치명/높음 발견 시 "수정 후 재테스트 필요"로 판정
- 수정-재테스트 반복은 동일 원인 3회 연속 실패 시 대표에게 에스컬레이션
- test-sub과 review-sub는 독립 Task로 병렬 실행 가능

## 완료 조건

- 치명/높음 미해결 결함 0건
- 필수 테스트 통과
- 코드 리뷰 승인
- PR 머지 완료

## 실패/에스컬레이션 조건

- 동일 원인 3회 연속 실패 시 대표에게 에스컬레이션
- 설계 결함 발견 시 design 스킬로 회귀 요청

## 완료 후 액션

1. 완료 요약 (테스트 결과 + PR 머지 상태)
2. docs/00-progress.md 갱신
3. 스킬 전환: test → deploy는 **승인 필수**

## 다음 스킬

- deploy
