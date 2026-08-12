# 문서 규칙

## 산출물 코드 체계

모든 산출물은 코드를 부여한다: PLN(기획), ANL(분석), DES(설계), DEV(개발), TST(테스트), DPL(배포), OPS(운영)

## 디렉토리별 역할

- `requirements/` — 요구사항 정의서, 용어 사전, 프로젝트 코드 체계
- `plans/` — Phase 계획서
- `analysis/` — 분석 보고서, 기술 스택 결정서
- `design/` — 설계서 (api/, data/, ui/ 하위 구조)
- `test-reports/` — 테스트 결과 (cases/, performance/, security/, acceptance/)
- `deploy/` — 배포 체크리스트, 환경 설정 가이드
- `releases/` — 릴리스 노트
- `bug-reports/` — 버그 리포트
- `operations/` — 운영 매뉴얼
- `feedback/` — 다음 Phase 피드백

## 작성 규칙

- 한국어로 작성
- Markdown 형식
- 파일명: kebab-case (예: api-design.md)
- 변경 없는 산출물은 이전 Phase 것을 그대로 유지
