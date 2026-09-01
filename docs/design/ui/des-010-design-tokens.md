# DES-010 디자인 토큰

> Phase 1: 기반 구축
> 작성일: 2026-08-23
> **원본**: [Notion DES-010](https://app.notion.com/p/3c5d066504ec81b9a958e830f2c5d585) · Git 동기화 2026-09-01
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

> **⚠ 개정 대기 (2026-09-01 승인 반영) — 규모 중**
> D-03(shadcn/ui 확정), D-05(라이트+다크), D-06(`in_review` 색상), D-25(반응형)에 따라 **웹·모바일 디자인 토큰 추가**가 필요하다.
> 확장안은 DES-012 §8, DES-015 §4-3에 이미 정리되어 있으며 본 문서로 흡수해야 한다.

Phase 1은 CLI + API 전용. CLI 출력 색상과 Phase 2 디자인 시스템 기반만 결정한다.

---

## CLI 출력 색상 (Phase 1)

### 터미널 색상 맵

| 의미 | ANSI 색상 | 용도 |
|------|----------|------|
| 성공 | green | 작업 완료, 정상 상태 |
| 오류 | red | 에러 메시지, 실패 상태 |
| 경고 | yellow | 경고, 대기 상태 |
| 정보 | cyan | 안내 메시지 |
| 강조 | bold | 중요 정보 (ID, 이름) |
| 비활성 | dim (gray) | 보조 정보 (타임스탬프) |

### 상태별 색상

| 상태 | 색상 | 적용 대상 |
|------|------|----------|
| ready / created | cyan | 프로젝트, Agent |
| running / in_progress | green | 프로젝트, Agent, Task |
| waiting | yellow | 프로젝트, Agent |
| paused | yellow | 프로젝트, Agent, Task |
| completed | green (dim) | 프로젝트, Agent, Task |
| failed | red | 프로젝트, Agent, Task |
| cancelled | dim | 프로젝트, Agent, Task |

> **⚠ 누락**: `in_review`(Task 검토 중) 색상이 정의되어 있지 않다. → **D-06 승인: `magenta` 부여**.

---

## Phase 2 디자인 시스템 기반

| 항목 | 선택 | 근거 |
|------|------|------|
| CSS 프레임워크 | Tailwind CSS | 유틸리티 퍼스트, React 호환, AI 코딩 최적 |
| UI 컴포넌트 라이브러리 | ~~Phase 2에서 결정~~ → **shadcn/ui 확정** | **D-03 승인.** 코드 소유권 보유, Tailwind 정합, Resizable·Command·DataTable 모두 존재 |
| 디자인 토큰 형식 | CSS 변수 (`--token-name`) | 런타임 테마 전환 지원 |

---

## ⚠ 2026-09-01 승인 반영 필요 항목

### 1. CLI 색상 보완 (D-06)

| 상태 | 추가 색상 |
|------|----------|
| in_review | **magenta** |

### 2. 웹 상태 토큰 (D-05 라이트+다크, DES-012 §8에서 이관)

| 상태 | CLI | 웹 토큰 | StatusDot | 애니메이션 |
|------|-----|---------|-----------|-----------|
| ready / created | cyan | `--status-ready` 청록 500 | ○ 테두리만 | 없음 |
| running / in_progress | green | `--status-running` 녹색 500 | ● 채움 | 은은한 맥박(2s) |
| waiting | yellow | `--status-waiting` 황색 500 | ◐ 반채움 | 없음 |
| paused | yellow | `--status-paused` 황색 400 | ◐ 반채움 | 없음 |
| in_review | **magenta** | `--status-review` 보라 500 | ● 채움 | 없음 |
| completed | green dim | `--status-done` 회색 500 | ○ 회색 | 없음 |
| failed | red | `--status-failed` 적색 500 | ● 적색 | 없음 |
| cancelled / skipped | dim | `--status-muted` 회색 400 | ○ 흐림 | 없음 |

**색상 외 이중 부호**: 색각 이상 사용자를 위해 상태를 색상만으로 구분하지 않는다.
StatusDot의 채움 패턴(채움/반채움/테두리) + StatusBadge의 상태명 텍스트를 병기하며, 대비는 WCAG AA(4.5:1)를 라이트·다크 두 모드 모두에서 만족한다.

### 3. 타이포 · 간격 (DES-012 §5-2에서 이관)

| 항목 | 데스크톱 | 모바일 (768px 미만) |
|------|---------|-------------------|
| 기본 단위 | 4px (Tailwind spacing) | 동일 |
| 표 행 높이 | 36px (compact) / 44px (comfortable) | **56px** |
| 본문 타이포 | 14px / 행간 20px | **16px** (iOS 자동 확대 방지) |
| 보조 타이포 | 12px (타임스탬프·ID) | 동일 |
| 카드 내부 여백 | 16px | 동일 |
| 섹션 간 간격 | 24px | 동일 |
| 최소 터치 타깃 | 32×32px | **44×44px** |
| 등폭 글꼴 | ID·상태코드·타임스탬프 | 동일 |

### 4. 브레이크포인트 (D-25 승인, DES-015 §4-1)

| 구간 | 폭 | 레이아웃 |
|------|-----|---------|
| Desktop | 1280px 이상 | 3-Pane |
| Tablet | 768 ~ 1279px | 2-Pane (트리는 드로어) |
| Mobile | 768px 미만 | 1-Pane + 하단 탭 4개 |

### 5. 테마 (D-05 승인)

라이트 + 다크 두 모드를 CSS 변수로 제공한다. 시스템 설정 추종 + 수동 토글.
`prefers-reduced-motion` 준수 — running 맥박 애니메이션 비활성화.

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 (CLI 색상 + Phase 2 기반 예비 결정) |
| — | 2026-09-01 | **Git 동기화** + 승인 반영 필요 항목(웹·모바일 토큰, 브레이크포인트, `in_review` 색상) 정리 |
