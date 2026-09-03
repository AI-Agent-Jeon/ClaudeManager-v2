# TST-001 테스트 케이스 문서

> Phase 1 테스트
> 버전: v1.1 (2026-09-03)
> **원본**: [Notion TST-001](https://app.notion.com/p/3d0d066504ec816586bae0037088bf81) · Git 동기화 2026-09-03
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

---

## 테스트 전략 요약

### 범위

- **대상 스토리**: Phase 1 Must 19건(PLN-002 §작업 목록) + 구현된 Should 4건(FR-005·FR-031·NFR-001·NFR-003) = **총 23건**
  - Must 19: FR-001·002·003·004·006·007·008·009·026·027·028·029·030, DAT-001·002·003, INT-001·003, NFR-002
  - Should(구현분) 4: FR-005, FR-031, NFR-001, NFR-003
  - 범위 제외(미구현 또는 지시 범위 외 Should/Could): FR-005 외 나머지 Should(FR-010·011, INT-002), FR-012(Could)

> **⚠ 커버리지 공백 (2026-09-03, test 9단계 수정 루프 2차 신설분)**: 본 문서 작성(v1) 이후 D-2·D-3 반영으로 신설된 `PATCH /api/conversations/:id/read` · `POST /api/artifacts` 엔드포인트 2종과 SCR-CH15(`cm artifacts add`) 화면 1종은 **위 케이스 본문에 TC 항목으로 등록되어 있지 않다.** 이번 루프 신설분은 단위·통합 테스트로 커버되며(dev-sub 병렬 반영), UAT 시나리오는 다음 루프에서 보강한다 — `docs/test-reports/acceptance/uat-scenarios.md`도 동일한 공백을 표기했다.

### 케이스 수

| 유형 | 건수 | 설명 |
|------|:---:|------|
| TC-UT (단위) | 27 | 상태 전이표, 경계값 계산, 파생 필드(syncStatus 등), 스키마 검증 |
| TC-IT (통합) | 50 | Route → Service → Repository → DB 전체 경로, API 단건 동작 |
| TC-ST (시나리오) | 5 | 서버 재시작 지속성, 게이트 전체 흐름 등 다단계 E2E |
| TC-PT (성능) | 2 | NFR-001·NFR-003 응답/전달 시간 |
| TC-SE (보안) | 2 | 인증 우회, 필드 위장 주입 차단 |
| **합계** | **86** | |

### 커버리지 목표 및 추정 현황

| 구분 | 목표 | 추정 현황(§기존 단위 테스트 매핑 근거) |
|------|:---:|------|
| Must (19건) | 80% | 완전 커버 15건, 부분 커버 4건(FR-001·DAT-001·DAT-002·FR-030 — 각 AC 일부 미커버) → **약 82%** (AC 단위 환산) |
| Should (구현 4건) | 60% | 완전 커버 2건(FR-005·FR-031), 부분 커버 2건(NFR-001·NFR-003 — 응답/전달 시간 자체는 미커버) → **약 55~60%** |

> 커버리지 수치는 §기존 단위 테스트 매핑 표를 근거로 한 추정치다. 실측(라인/브랜치 커버리지 리포트)은 test 스킬의 다음 절차(테스트 실행)에서 확인한다.

### 기법 적용 원칙

- 모든 Must 수용 기준은 정상 흐름(happy path) 1건 이상 + 예외 흐름(있는 경우) 1건 이상으로 변환한다.
- 경계가 있는 수용 기준(WIP=1, 타임아웃 30분, 페이지 크기, 문자열 길이, 상태 전이 허용/불허)에는 BVA(경계값)·EP(동치 분할) 케이스를 추가한다. 근거는 PLN-001 수용 기준을 우선하고, 수용 기준에 수치가 없으나 DES-002/DES-006/DES-007이 구체 수치를 명시한 경우 그 문서를 근거로 표기한다(예: 메시지 길이, 재시도 횟수).
- 근거 문서에 없는 수치(예: 프로젝트 이름·설명의 문자열 길이 제한)는 케이스를 만들지 않고 §명세 공백에 기록한다.

---

## 케이스 본문

### Layer 1 — 서버 + 저장소

#### FR-001 백엔드 서버 시작/종료 (Must)

##### TC-IT-001: 서버 시작 시 지정 포트에서 HTTP 요청 수신
- **대상 스토리**: FR-001
- **수용 기준**: Given 서버 실행 파일이 존재할 때 When 서버 시작 명령을 실행하면 Then 지정 포트에서 HTTP 요청을 수신한다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: DB 파일 없음(최초 기동) 또는 존재(재기동)
- **테스트 데이터**: 기본 포트 3000
- **기대 결과**: `GET /api/health` 200 응답, `{"status":"ok"}`
- **매핑**: `tests/unit/backend/routes/health-auth.routes.test.ts` `GET /api/health — FR-001`

##### TC-IT-002: SIGTERM 수신 시 진행 중 요청 완료 후 정상 종료
- **대상 스토리**: FR-001
- **수용 기준**: Given 서버가 실행 중일 때 When 종료 신호(SIGTERM)를 보내면 Then 진행 중인 요청을 완료한 후 정상 종료한다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 서버 실행 중, 활성 요청 존재
- **테스트 데이터**: SIGTERM 시그널
- **기대 결과**: 활성 요청 완료 후 DB 연결 종료 및 프로세스 종료
- **미커버**: 서버 프로세스 레벨 시그널 핸들링을 다루는 단위 테스트가 없다. `ws/hub.test.ts`의 "WebSocketHub — 종료(Graceful Shutdown 3단계)"는 WS 허브 종료만 다루고 HTTP 서버 전체의 SIGTERM 처리는 다루지 않는다.

##### TC-IT-003: DB 연결 실패 시 시작 중단
- **대상 스토리**: FR-001
- **수용 기준**: Given 서버가 시작될 때 When DB 연결에 실패하면 Then 에러 메시지와 함께 시작이 중단된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: DB 파일 경로 접근 불가(권한 오류 등)
- **테스트 데이터**: 잘못된 DB 경로
- **기대 결과**: 에러 로그 출력 + 프로세스 비정상 종료(리스닝 시작 안 함)
- **미커버**: 해당 실패 경로를 다루는 단위 테스트 없음.

##### TC-PT-001: API 응답 성능 3초 이내 (NFR-001, Should)
- **대상 스토리**: NFR-001
- **수용 기준**: Given 서버가 정상 가동 중일 때 When 임의의 CRUD API 요청을 보내면 Then 3초 이내에 응답한다
- **유형**: E2E (성능)
- **기법**: BVA
- **사전 조건**: 서버 정상 가동, 표준 부하(단일 사용자)
- **테스트 데이터**: 경계값 — 2.99s(통과) / 3.00s(경계, 통과) / 3.01s(실패)
- **기대 결과**: 3초 이내 응답률 100%(단일 사용자 전제)
- **미커버**: `tests/unit/**`에 성능/타이밍을 측정하는 테스트가 없다(`docs/test-reports/performance/`에서 별도 실측 필요).

#### DAT-001 SQLite 데이터 영속 저장 (Must)

##### TC-ST-001: 프로젝트 생성 후 서버 재시작 시 데이터 보존
- **대상 스토리**: DAT-001
- **수용 기준**: Given 프로젝트를 생성한 후 When 서버를 재시작하면 Then 생성한 프로젝트가 그대로 조회된다
- **유형**: E2E
- **기법**: 정상 흐름
- **사전 조건**: 프로젝트 1건 생성 완료
- **테스트 데이터**: 프로젝트명 `cm-v2`
- **기대 결과**: 재시작 후 `cm project list`에 동일 프로젝트 표시
- **미커버**: 단위 테스트는 인메모리/임시 DB로 격리 실행되어 프로세스 재시작을 재현하지 않는다. TC-UA-006(UAT 문서)로 E2E 검증한다.

##### TC-IT-004: DB 파일 없을 때 초기 스키마 자동 생성
- **대상 스토리**: DAT-001
- **수용 기준**: Given SQLite 파일이 없을 때 When 서버를 최초 시작하면 Then 초기 스키마가 적용된 DB 파일이 생성된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: DB 파일 부재
- **테스트 데이터**: 신규 경로
- **기대 결과**: 마이그레이션 전건 적용된 DB 파일 생성
- **매핑**: `tests/unit/backend/db/migrations.test.ts` `마이그레이션 적용 — DES-003 §9-2`, `tests/unit/backend/routes/health-auth.routes.test.ts` `부팅 — DAT-001 · DAT-002`

#### DAT-002 DB 마이그레이션 체계 (Must)

##### TC-IT-005: 미적용 마이그레이션 순서대로 실행
- **대상 스토리**: DAT-002
- **수용 기준**: Given 새로운 마이그레이션 파일이 추가되었을 때 When 서버를 시작하면 Then 미적용 마이그레이션이 순서대로 실행된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 마이그레이션 파일 N개 중 일부 미적용
- **테스트 데이터**: 0000~현재까지의 마이그레이션 파일 순번
- **기대 결과**: 파일명 순서대로 적용, 스키마와 `schema.ts` 일치
- **매핑**: `migrations.test.ts` 전체, `tests/unit/backend/db/schema.test.ts` `schema.ts ↔ migrations/*.sql`

##### TC-IT-006: 마이그레이션 실패 시 롤백 및 에러 보고
- **대상 스토리**: DAT-002
- **수용 기준**: Given 마이그레이션이 실패할 때 When 에러가 발생하면 Then 해당 마이그레이션은 롤백되고 에러가 보고된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: 의도적으로 손상된 SQL 문을 포함한 마이그레이션 파일
- **테스트 데이터**: 구문 오류 SQL
- **기대 결과**: 트랜잭션 롤백, 에러 로그 출력, 이후 재시작 시 재시도 가능
- **미커버**: `migrations.test.ts`의 describe 목록에 적용 성공·CHECK 제약·FTS 관련 테스트만 있고 실패·롤백 경로 테스트가 없다.

#### DAT-003 대화·승인·진행 데이터 영속 저장 (Must)

##### TC-ST-002: 대화·승인·Phase 데이터 재시작 후 보존
- **대상 스토리**: DAT-003
- **수용 기준**: Given 대화·승인·Phase 데이터가 생성될 때 When 서버를 재시작하면 Then 모든 데이터가 그대로 조회된다
- **유형**: E2E
- **기법**: 정상 흐름
- **사전 조건**: 대화 1건, 승인 1건, Phase 진행 데이터 존재
- **테스트 데이터**: CH-MAIN 메시지 1건, APV-GATE 1건
- **기대 결과**: 재시작 후 `cm chat log`, `cm approvals`, `cm progress`가 동일 데이터 반환
- **미커버**: 단위 테스트는 재시작을 재현하지 않음 → TC-UA-006(UAT)로 검증

##### TC-UT-001: approvals 단일 테이블 통합 스키마 검증
- **대상 스토리**: DAT-003
- **수용 기준**: Given 의사결정 요청과 승인을 저장할 때 When 스키마를 구성하면 Then 단일 `approvals` 테이블로 통합 관리된다
- **유형**: Unit
- **기법**: 정상 흐름
- **사전 조건**: -
- **테스트 데이터**: `approvals` 테이블 CHECK 제약 5건
- **기대 결과**: `decision_requests` 등 별도 테이블 없이 `approvals` 단일 테이블로 승인·의사결정 저장
- **매핑**: `migrations.test.ts` `approvals CHECK 5건 — DES-003 §4-1`

---

### Layer 2 — 인증

#### FR-002 토큰 기반 인증 (Must)

##### TC-IT-007: 올바른 인증 정보로 토큰 발급
- **대상 스토리**: FR-002
- **수용 기준**: Given 올바른 인증 정보를 가지고 있을 때 When 로그인 요청을 보내면 Then 인증 토큰이 발급된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 유효한 시크릿 존재
- **테스트 데이터**: 올바른 시크릿 문자열
- **기대 결과**: JWT 발급, 만료일시 7일
- **매핑**: `tests/unit/backend/services/auth.service.test.ts` `AuthService.login — FR-002`, `tests/unit/backend/routes/health-auth.routes.test.ts` `POST /api/auth/login — FR-002`

##### TC-IT-008: 잘못된 인증 정보로 401
- **대상 스토리**: FR-002
- **수용 기준**: Given 잘못된 인증 정보를 가지고 있을 때 When 로그인 요청을 보내면 Then 401 에러가 반환된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: -
- **테스트 데이터**: 오기입 시크릿
- **기대 결과**: `401 AUTH_INVALID_SECRET`
- **매핑**: 동일 파일

##### TC-IT-009: 토큰 만료 시 401 + 재로그인 안내
- **대상 스토리**: FR-002
- **수용 기준**: Given 인증 토큰이 만료되었을 때 When API 요청을 보내면 Then 401 에러와 재로그인 안내가 반환된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: 만료된 JWT
- **테스트 데이터**: 만료 시각이 지난 토큰
- **기대 결과**: `401` + `cm auth login` 안내 메시지(CLI 레벨: `tests/unit/cli/commands/auth.test.ts`)
- **매핑**: `auth.service.test.ts`, `cli/commands/auth.test.ts` `runStatus`

##### TC-UT-002: 인증 상태 EP 4분류
- **대상 스토리**: FR-002, NFR-002
- **수용 기준**: 위 3개 AC의 조합
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: {유효 토큰, 만료 토큰, 토큰 없음, 형식 오류 토큰(Bearer 접두어 누락 등)}
- **기대 결과**: 유효만 통과, 나머지 3클래스는 401
- **매핑**: `health-auth.routes.test.ts` `인증 미들웨어 — NFR-002`

#### NFR-002 API 인증 미들웨어 (Must)

##### TC-IT-010: 토큰 없이 보호 API 요청 시 401
- **대상 스토리**: NFR-002
- **수용 기준**: Given 인증 토큰 없이 When 보호된 API에 요청하면 Then 401 Unauthorized가 반환된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: `Authorization` 헤더 없음
- **테스트 데이터**: `GET /api/projects`
- **기대 결과**: `401`
- **매핑**: `health-auth.routes.test.ts` `인증 미들웨어 — NFR-002`

##### TC-IT-011: 유효 토큰으로 보호 API 요청 시 정상 응답
- **대상 스토리**: NFR-002
- **수용 기준**: Given 유효한 인증 토큰으로 When 보호된 API에 요청하면 Then 정상 응답이 반환된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 유효 JWT
- **테스트 데이터**: `Authorization: Bearer <JWT>`
- **기대 결과**: `200`
- **매핑**: 동일

##### TC-SE-001: 변조된 토큰으로 보호 API 접근 시도
- **대상 스토리**: NFR-002
- **수용 기준**: NFR-002 수용 기준의 보안 관점 확장
- **유형**: Security
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: 서명이 조작된 JWT, 만료 JWT, 빈 문자열 토큰
- **기대 결과**: 전건 401, 상세 원인이 응답 본문에 노출되지 않음(시크릿 유출 방지)
- **매핑**: `health-auth.routes.test.ts` `인증 미들웨어 — NFR-002`, `errors.test.ts` `toErrorResponse — 4필드 고정`

---

### Layer 3 — 프로젝트 CRUD

#### FR-003 프로젝트 생성 (Must)

##### TC-IT-012: 정상 생성 → ready 상태
- **대상 스토리**: FR-003
- **수용 기준**: Given 인증된 상태일 때 When 프로젝트 이름과 설명을 제공하면 Then 새 프로젝트가 '준비' 상태로 생성된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 인증됨
- **테스트 데이터**: `{name:"my-web-app", description:"웹 애플리케이션 개발"}`
- **기대 결과**: `201`, `status: "ready"`
- **매핑**: `tests/unit/backend/services/project.service.test.ts` `ProjectService.create — FR-003`, `tests/unit/backend/routes/projects.routes.test.ts` `POST /api/projects — FR-003`

##### TC-IT-013: 동일 이름 존재 시 중복 에러
- **대상 스토리**: FR-003
- **수용 기준**: Given 동일 이름의 프로젝트가 존재할 때 When 같은 이름으로 생성하면 Then 중복 에러가 반환된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: 동일 이름 프로젝트 기존재
- **테스트 데이터**: 동일 `name`
- **기대 결과**: `409 PROJECT_NAME_CONFLICT`
- **매핑**: 동일

##### TC-UT-003: 이름 필수값 누락 EP
- **대상 스토리**: FR-003
- **수용 기준**: FR-003 AC1의 입력 검증 확장
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: `{name: undefined}`, `{name: ""}`
- **기대 결과**: `400 VALIDATION_ERROR`
- **매핑**: `projects.routes.test.ts` `POST /api/projects — FR-003`

#### FR-004 프로젝트 목록 조회 (Must)

##### TC-IT-014: 3건 존재 시 3건 반환
- **대상 스토리**: FR-004
- **수용 기준**: Given 프로젝트가 3개 존재할 때 When 목록 조회를 요청하면 Then 3개 프로젝트의 이름, 상태, 생성일이 반환된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 프로젝트 3건
- **테스트 데이터**: -
- **기대 결과**: `data.length === 3`, 각 항목에 name/status/createdAt
- **매핑**: `project.service.test.ts` `ProjectService.list — FR-004`, `projects.routes.test.ts` `GET /api/projects — FR-004`

##### TC-IT-015: 0건일 때 빈 목록
- **대상 스토리**: FR-004
- **수용 기준**: Given 프로젝트가 없을 때 When 목록 조회를 요청하면 Then 빈 목록이 반환된다
- **유형**: Integration
- **기법**: 예외 흐름(빈 상태)
- **사전 조건**: 프로젝트 0건
- **테스트 데이터**: -
- **기대 결과**: `data: []`, CLI는 "프로젝트가 없습니다" + 생성 명령 안내(EVT-P02-3)
- **매핑**: 동일 + `cli/commands/project.test.ts` `runProjectList`

##### TC-UT-004: pageSize BVA
- **대상 스토리**: FR-004
- **수용 기준**: FR-004 AC1의 페이지네이션 확장(근거: DES-004 `PaginationOpts` — 기본 20, 최대 100)
- **유형**: Unit
- **기법**: BVA
- **사전 조건**: -
- **테스트 데이터**: pageSize = {1(최소, 유효), 20(기본값), 100(최대, 유효), 101(최대+1, 무효)}
- **기대 결과**: 1·20·100은 정상 처리, 101은 `400 VALIDATION_ERROR`
- **매핑**: `project.repository.test.ts` `ProjectRepository.findMany · count` (경계값 자체는 명시 확인 필요 — §명세 공백 참조)

##### TC-UT-005: 프로젝트 건수 EP
- **대상 스토리**: FR-004
- **수용 기준**: AC1·AC2 통합
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: {0건, 1건, 다수(3건 이상)}
- **기대 결과**: 각 클래스에서 정상 응답 형태 유지
- **매핑**: `project.repository.test.ts`, `project.service.test.ts`

#### FR-005 프로젝트 상세 조회 (Should, 구현됨)

##### TC-IT-016: 상세 조회 시 6필드 + Agent 목록 반환
- **대상 스토리**: FR-005
- **수용 기준**: Given 프로젝트가 존재할 때 When 상세 조회를 요청하면 Then 이름, 설명, 상태, 생성일, Agent 목록이 반환된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 프로젝트 + Agent N건
- **테스트 데이터**: -
- **기대 결과**: name/description/status/createdAt/updatedAt + agents[]
- **매핑**: `project.service.test.ts` `ProjectService.getById — FR-005`, `projects.routes.test.ts` `GET /api/projects/:id — FR-005`

##### TC-IT-017: 존재하지 않는 ID로 404
- **대상 스토리**: FR-005
- **수용 기준**: Given 존재하지 않는 프로젝트 ID로 When 상세 조회하면 Then 404 에러가 반환된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: -
- **테스트 데이터**: 임의 UUID
- **기대 결과**: `404 PROJECT_NOT_FOUND`
- **매핑**: 동일

##### TC-UT-006: ID 축약 조회 EP (DES-006 EVT-P03-4 근거)
- **대상 스토리**: FR-005
- **수용 기준**: FR-005 AC 확장 — CLI ID 축약 규칙(DES-006 §8)
- **유형**: Unit
- **기법**: EP
- **사전 조건**: 프로젝트 여러 건, 그 중 8자리 접두어가 우연히 같은 2건 포함
- **테스트 데이터**: {전체 UUID, 고유 8자리, 충돌 8자리(다중 후보), 존재하지 않는 8자리}
- **기대 결과**: 전체 UUID/고유 8자리 → 단건 조회 성공, 충돌 8자리 → 후보 목록 + "더 긴 ID를 입력하세요", 미존재 → 404
- **매핑**: `tests/unit/cli/runtime.test.ts` `resolveId`, `toIdLookupFailure`, `ambiguousIdBlock`

#### FR-006 프로젝트 상태 변경 (Must)

##### TC-IT-018: ready→running 정상 전이 + 로그 기록
- **대상 스토리**: FR-006
- **수용 기준**: Given 프로젝트가 '준비' 상태일 때 When 상태를 '진행 중'으로 변경하면 Then 상태가 갱신되고 변경 로그가 기록된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 프로젝트 `ready`
- **테스트 데이터**: `--set running`
- **기대 결과**: `status: running`, `status_changes` 1건 추가
- **매핑**: `project.service.test.ts` `ProjectService.updateStatus — FR-006`, `projects.routes.test.ts` `PATCH /api/projects/:id/status — FR-006`

##### TC-IT-019: 허용되지 않은 전환 시 에러 + 허용 목록
- **대상 스토리**: FR-006
- **수용 기준**: Given 허용되지 않은 상태 전환일 때 When 상태 변경을 요청하면 Then 에러와 허용 전환 목록이 반환된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: 프로젝트 `ready`
- **테스트 데이터**: `--set completed` (ready에서 직접 불가)
- **기대 결과**: `422 INVALID_TRANSITION` + `["running","cancelled"]`
- **매핑**: 동일 + `tests/unit/shared/state-transitions.test.ts` `Project 상태 머신 — DES-007 §2`

##### TC-UT-007: 프로젝트 상태 8종 × 허용 전이 EP 전건
- **대상 스토리**: FR-006
- **수용 기준**: DES-007 §2 `PROJECT_TRANSITIONS` 전체
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: ready/running/waiting/paused/pending_completion/failed/completed/cancelled × 각 허용·비허용 전이
- **기대 결과**: 허용 목록과 정확히 일치
- **매핑**: `state-transitions.test.ts` `Project 상태 머신 — DES-007 §2`

##### TC-UT-008: 종료 상태(completed/cancelled) 전이 시도 경계
- **대상 스토리**: FR-006
- **수용 기준**: FR-006 AC2 확장 — 종료 상태는 전이 목록이 빈 배열(경계)
- **유형**: Unit
- **기법**: BVA
- **사전 조건**: 프로젝트 `completed` 또는 `cancelled`
- **테스트 데이터**: 임의 `--set` 값
- **기대 결과**: 항상 `422 INVALID_TRANSITION`, 허용 목록 `[]`
- **매핑**: `state-transitions.test.ts`

---

### Layer 4 — 상태 추적

#### FR-007 Agent 상태 CRUD (Must)

##### TC-IT-020: Agent 등록 시 DB 저장
- **대상 스토리**: FR-007
- **수용 기준**: Given Agent가 등록될 때 When 상태 저장을 요청하면 Then Agent 정보(이름, 유형, 상태, 프로젝트ID)가 DB에 저장된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 프로젝트 존재
- **테스트 데이터**: `{name:"dev-sub-01", type:"dev-sub", projectId}`
- **기대 결과**: `status: created`로 저장
- **매핑**: `tests/unit/backend/services/agent.service.test.ts` `AgentService.create — FR-007`, `tests/unit/backend/routes/agents.routes.test.ts` `POST /api/agents — FR-007`

##### TC-IT-021: 상태 변경 시 갱신 + 이전 상태 로그
- **대상 스토리**: FR-007
- **수용 기준**: Given Agent 상태가 변경될 때 When 상태 갱신을 요청하면 Then 상태가 갱신되고 이전 상태가 로그에 기록된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: Agent `created`
- **테스트 데이터**: `--set running`
- **기대 결과**: `status: running`, `status_changes`에 `created→running` 기록
- **매핑**: `agent.service.test.ts` `AgentService.updateStatus — FR-007`, `agents.routes.test.ts` `PATCH /api/agents/:id/status — FR-007`

##### TC-IT-022: 프로젝트 ID로 Agent 목록 조회
- **대상 스토리**: FR-007
- **수용 기준**: Given 프로젝트 ID로 When Agent 목록을 조회하면 Then 해당 프로젝트의 모든 Agent 정보가 반환된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 프로젝트에 Agent 2건 이상
- **테스트 데이터**: `?projectId=<id>`
- **기대 결과**: 해당 프로젝트 소속 Agent 전건 반환
- **매핑**: `agent.service.test.ts` `AgentService.list — FR-007`, `agent.repository.test.ts` `AgentRepository.findByProjectId`

##### TC-UT-009: Agent 상태 7종 × 허용 전이 EP 전건
- **대상 스토리**: FR-007
- **수용 기준**: DES-007 §3 `AGENT_TRANSITIONS` 전체
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: created/running/waiting/paused/failed/completed/cancelled × 허용·비허용 전이
- **기대 결과**: 허용 목록과 정확히 일치
- **매핑**: `state-transitions.test.ts` `Agent 상태 머신 — DES-007 §3`

##### TC-UT-010: 재시도 횟수 경계 (근거: DES-006 SCR-AG03 "재시도 n/3")
- **대상 스토리**: FR-007
- **수용 기준**: FR-007 AC2 확장. **주의**: 정확한 재시도 상한 "3"은 PLN-001 수용 기준에 명시되어 있지 않고 DES-006 화면 명세에서만 확인된다 — §명세 공백 참조
- **유형**: Unit
- **기법**: BVA
- **사전 조건**: Agent `failed`
- **테스트 데이터**: 재시도 횟수 {0→1(허용), 1→2(허용), 2→3(경계, 문서상 허용 여부 불명확)}
- **기대 결과**: (명세 공백으로 인해 기대 결과 확정 불가 — develop 단계에서 실제 구현 값 확인 후 보완 필요)
- **매핑**: 미커버 — `agent.repository.test.ts`에 재시도 횟수 경계를 직접 검증하는 case 없음(§명세 공백 참조)

##### TC-IT-023: 상위 프로젝트 비활성 시 Agent running 차단
- **대상 스토리**: FR-007
- **수용 기준**: FR-007의 하위 규칙(DES-006 EVT-AG04-2, DES-007 §8-1)
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: 프로젝트 `paused`, Agent `created`
- **테스트 데이터**: `--set running`
- **기대 결과**: `422 PARENT_NOT_ACTIVE` + 프로젝트 활성화 안내
- **매핑**: `agent.service.test.ts`, `agents.routes.test.ts`

#### FR-008 Task 상태 CRUD (Must)

##### TC-IT-024: Task 생성 시 DB 저장
- **대상 스토리**: FR-008
- **수용 기준**: Given Agent에 Task가 할당될 때 When Task 생성을 요청하면 Then Task 정보(이름, 상태, AgentID)가 DB에 저장된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: Agent 존재
- **테스트 데이터**: `{title:"DB 스키마 구현", agentId}`
- **기대 결과**: `status: ready`로 저장
- **매핑**: `tests/unit/backend/services/task.service.test.ts` `TaskService.create — FR-008`, `tests/unit/backend/routes/tasks.routes.test.ts` `POST /api/tasks — FR-008`

##### TC-IT-025: Task 상태 변경 시 갱신 + 로그
- **대상 스토리**: FR-008
- **수용 기준**: Given Task 상태가 변경될 때 When 상태 갱신을 요청하면 Then 상태가 갱신되고 변경 로그가 기록된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: Task `ready`
- **테스트 데이터**: `--set in_progress`
- **기대 결과**: `status: in_progress`, `status_changes` 기록
- **매핑**: `task.service.test.ts` `TaskService.updateStatus — FR-008`, `tasks.routes.test.ts` `PATCH /api/tasks/:id/status — FR-008`

##### TC-UT-011: Task 상태 8종 × 허용 전이 EP 전건
- **대상 스토리**: FR-008
- **수용 기준**: DES-007 §4 Task 상태 머신 전체
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: ready/in_progress/in_review/paused/failed/completed/cancelled/skipped
- **기대 결과**: 허용 목록과 정확히 일치
- **매핑**: `state-transitions.test.ts` `Task 상태 머신 — DES-007 §4`

##### TC-UT-012: in_progress→completed 직접 전이 금지 경계
- **대상 스토리**: FR-008
- **수용 기준**: DES-005 시나리오3 "`in_review` 경유는 필수다. `in_progress → completed` 직접 전이는 허용되지 않는다"
- **유형**: Unit
- **기법**: BVA(상태 전이 경계)
- **사전 조건**: Task `in_progress`
- **테스트 데이터**: `--set completed`
- **기대 결과**: `422 INVALID_TRANSITION`, 허용 목록에 `in_review`만 포함(비종료 전이 기준)
- **매핑**: `state-transitions.test.ts`, `tasks.routes.test.ts`

#### FR-009 상태 변경 이력 (Must)

##### TC-IT-026: 상태 변경 시 이력 자동 기록
- **대상 스토리**: FR-009
- **수용 기준**: Given 프로젝트/Agent/Task 상태가 변경될 때 When 변경이 발생하면 Then 엔티티 유형, ID, 이전 상태, 새 상태, 타임스탬프가 자동 기록된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 임의 엔티티 상태 변경 1건
- **테스트 데이터**: -
- **기대 결과**: `status_changes` 행 1건 생성, 5개 필드 전부 채워짐
- **매핑**: `tests/unit/backend/services/status-change.service.test.ts` `StatusChangeService.record`, `tests/unit/backend/repositories/status-change.repository.test.ts` `StatusChangeRepository.insert`

##### TC-IT-027: 특정 엔티티 이력 시간순 조회
- **대상 스토리**: FR-009
- **수용 기준**: Given 특정 엔티티의 When 상태 변경 이력을 조회하면 Then 시간순으로 모든 변경 내역이 반환된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 특정 Task에 이력 4건(ready→in_progress→in_review→completed)
- **테스트 데이터**: `?entity-type=task&entity-id=<id>`
- **기대 결과**: 4건이 시각 오름차순으로 반환
- **매핑**: `status-change.service.test.ts` `StatusChangeService.list`, `tests/unit/backend/routes/status-changes.routes.test.ts` `GET /api/status-changes — FR-009`

##### TC-UT-013: 이력 건수 EP
- **대상 스토리**: FR-009
- **수용 기준**: AC2 확장 — 빈 상태 처리(DES-006 EVT-SC01-3)
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: {0건(이력 없는 엔티티), 1건, 다수(4건 이상)}
- **기대 결과**: 0건 → "상태 변경 이력이 없습니다" 안내, 그 외 정상 목록
- **매핑**: `status-change.repository.test.ts` `StatusChangeRepository.findMany · count`, `cli/commands/status-changes.test.ts` `runStatusChangeList`

---

### Layer 5 — 지휘 채널

#### FR-026 대화 채널 (Must)

##### TC-IT-028: 최초 기동 시 CH-MAIN 자동 생성, 삭제 불가
- **대상 스토리**: FR-026
- **수용 기준**: Given 시스템이 최초 기동될 때 When 초기화가 완료되면 Then CH-MAIN 채널 1개가 자동 생성되고 삭제할 수 없다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: DB 최초 기동(빈 `conversations`)
- **테스트 데이터**: -
- **기대 결과**: `channel_type='main'` 1행 생성, 재기동해도 1행 유지(멱등)
- **매핑**: `tests/unit/backend/bootstrap/bootstrap.service.test.ts` `BootstrapService.seed — 멱등성(R-1 핵심 방어선)`, `tests/unit/backend/services/conversation.service.test.ts` `ensureMainChannel — 부트스트랩(R-01)`

##### TC-IT-029: Agent 생성 시 CH-AGENT 자동 생성(한 트랜잭션)
- **대상 스토리**: FR-026
- **수용 기준**: Given Agent가 생성될 때 When 등록이 완료되면 Then 해당 Agent의 CH-AGENT 채널이 자동 생성된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 프로젝트 존재
- **테스트 데이터**: Agent 생성 요청
- **기대 결과**: Agent 생성과 채널 개설이 원자적으로 수행(둘 다 성공 또는 둘 다 실패)
- **매핑**: `conversation.service.test.ts` `createForAgent — 채널 생명주기(D-09)`, `tests/unit/backend/services/agent-atomicity.test.ts` `Agent 생성 원자성`

##### TC-IT-030: Agent 종료(completed/cancelled) 시 채널 readonly 전환
- **대상 스토리**: FR-026
- **수용 기준**: Given Agent가 종료(completed/cancelled)될 때 When 상태가 변경되면 Then 채널이 읽기 전용으로 전환되고 삭제되지 않는다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: Agent `running`, 채널 `active`
- **테스트 데이터**: `--set completed`
- **기대 결과**: 채널 `status: readonly`, 행 유지(삭제 없음)
- **매핑**: `conversation.service.test.ts` `markReadonly — Agent 종료 시(DES-007 v2 §8)`

##### TC-UT-014: Sub-Agent 직접 대화 채널 미제공
- **대상 스토리**: FR-026
- **수용 기준**: Given Sub-Agent가 있을 때 When 대표가 조회하면 Then Sub-Agent와의 직접 대화 채널은 제공되지 않는다 (그래프 규칙 3)
- **유형**: Unit
- **기법**: EP
- **사전 조건**: Sub-Agent 존재(대화 채널 생성 대상 아님)
- **테스트 데이터**: -
- **기대 결과**: `conversations` 조회에 Sub-Agent 채널이 나타나지 않음
- **미커버**: Sub-Agent 자체가 Phase 1의 별도 엔티티로 모델링되어 있지 않아(Agent 테이블만 존재) 이 규칙을 직접 검증하는 테스트가 없다 — 아키텍처 규칙으로 암묵 준수. §명세 공백 참조

##### TC-UT-015: 채널 상태 3종 × 발화/조회/검색 허용 여부 매트릭스
- **대상 스토리**: FR-026, FR-027
- **수용 기준**: DES-007 §5 상태별 허용 표
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: {active, readonly, archived} × {발화, 조회, 검색}
- **기대 결과**: active만 발화 가능(✅✅✅), readonly·archived는 발화 불가(❌✅✅)
- **매핑**: `state-transitions.test.ts` `대화 채널 상태 머신 — DES-007 §5(D-27)`, `conversation.repository.test.ts` `updateStatus · archiveWithSnapshot`

#### FR-027 메시지 저장·조회·검색 (Must)

##### TC-ST-003: 대화 후 서버 재시작 시 메시지 보존
- **대상 스토리**: FR-027
- **수용 기준**: Given 대화가 오간 후 When 서버를 재시작하면 Then 모든 메시지가 그대로 조회된다
- **유형**: E2E
- **기법**: 정상 흐름
- **사전 조건**: 메시지 N건 발화
- **테스트 데이터**: -
- **기대 결과**: 재시작 후 동일 메시지 전건 조회
- **미커버**: 단위 테스트는 재시작을 재현하지 않음 → TC-UA-006(UAT)

##### TC-IT-031: Agent 삭제 시 대화 archived 전환 + 이름 보존
- **대상 스토리**: FR-027
- **수용 기준**: Given Agent가 삭제될 때 When 삭제가 완료되면 Then 대화는 삭제되지 않고 `archived`로 전환되며 Agent명·프로젝트명이 보존된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: Agent + 채널 `active`
- **테스트 데이터**: `DELETE /api/agents/:id`
- **기대 결과**: 채널 `status: archived`, `entitySnapshot: {agentName, projectName, agentType}`, Agent 행 삭제 후에도 채널 조회 시 이름 표시
- **매핑**: `conversation.service.test.ts` `archiveByEntity — Agent 삭제 시(D-27)`, `tests/unit/backend/repositories/conversation-project-filter.test.ts` `project 필터 — 삭제된 Agent(D-27)`, `tests/unit/backend/routes/agent-delete-atomicity.test.ts`

##### TC-IT-032: 검색어로 전 채널 전문 검색
- **대상 스토리**: FR-027
- **수용 기준**: Given 검색어를 입력할 때 When 전 채널 검색을 실행하면 Then 본문이 일치하는 메시지가 채널명·시각과 함께 반환된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 메시지 다수, 검색어 포함 메시지 1건 이상
- **테스트 데이터**: `q=설계서`
- **기대 결과**: 채널명·시각·스니펫 포함 결과 반환
- **매핑**: `tests/unit/backend/repositories/message.repository.test.ts` `search — FTS5 전문 검색`, `tests/unit/backend/services/conversation.service.test.ts` `search — FR-027 FTS5`, `tests/unit/backend/routes/conversations.routes.test.ts` `GET /api/conversations/search — FR-027 FTS5`

##### TC-IT-033: Agent 보고 4필드 구조화 저장
- **대상 스토리**: FR-027
- **수용 기준**: Given Agent 보고가 도착할 때 When 저장되면 Then 요약·수행 내용·산출물·미해결 사항 4개 필드로 구조화되어 저장된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: -
- **테스트 데이터**: `msgType='MSG-03'` 페이로드
- **기대 결과**: `structured: {summary, workDone, artifacts, openIssues}` 저장
- **매핑**: `message.repository.test.ts` `insert · findById`, `conversation.service.test.ts` `sendMessage — FR-027`

##### TC-UT-016: 메시지 본문 길이 BVA (근거: DES-002 §6-3, minLength 1 / maxLength 10000)
- **대상 스토리**: FR-027
- **수용 기준**: FR-027 AC4 확장(스키마 검증)
- **유형**: Unit
- **기법**: BVA
- **사전 조건**: -
- **테스트 데이터**: 본문 길이 {0자(무효), 1자(유효 최소), 10000자(유효 최대), 10001자(무효)}
- **기대 결과**: 0자·10001자 → `400 VALIDATION_ERROR`, 1자·10000자 → 정상 저장
- **매핑**: 미커버 — `conversation.service.test.ts` `sendMessage — FR-027`에 길이 경계 케이스 명시 확인 필요(스키마 정의는 DES-002에 있으나 해당 경계값을 직접 테스트하는 case는 describe 목록에서 확인되지 않음)

##### TC-UT-017: 검색어 길이 BVA (근거: DES-002 §5, minLength 2)
- **대상 스토리**: FR-027
- **수용 기준**: DES-006 EVT-CH13-2 "검색어는 2자 이상이어야 합니다"
- **유형**: Unit
- **기법**: BVA
- **사전 조건**: -
- **테스트 데이터**: 검색어 길이 {0자(무효), 1자(무효), 2자(유효 최소)}
- **기대 결과**: 0·1자 → `400`, 2자 이상 → 정상 검색
- **매핑**: `message.repository.test.ts` `search — FTS5 전문 검색`(경계값 자체 검증은 §명세 공백 후보)

##### TC-UT-018: 커서 페이지네이션 limit BVA (근거: DES-002 §4, 1~100, 기본 50)
- **대상 스토리**: FR-027
- **수용 기준**: FR-027 AC1(조회) 확장
- **유형**: Unit
- **기법**: BVA
- **사전 조건**: 메시지 150건 이상
- **테스트 데이터**: limit = {0(무효), 1(최소), 50(기본), 100(최대), 101(무효)}
- **기대 결과**: 0·101 → `400`, 1·50·100은 정상 처리
- **매핑**: `message.repository.test.ts` `listByCursor`, `conversation.service.test.ts` `listMessages — 커서 페이지네이션(FR-027)`, `conversations.routes.test.ts` `GET /api/conversations/:id/messages — 커서 페이지네이션(FR-027)`

##### TC-SE-002: senderRole/msgType 클라이언트 주입 차단
- **대상 스토리**: FR-027
- **수용 기준**: DES-002 §6-3 "`additionalProperties: false`가 없으면 클라이언트가 `senderRole: agent`를 실어 대표 발화를 Agent 보고로 위장할 수 있다"
- **유형**: Security
- **기법**: EP(악의적 입력)
- **사전 조건**: 인증됨, 채널 `active`
- **테스트 데이터**: `{body:"...", senderRole:"agent", msgType:"MSG-03"}`
- **기대 결과**: 추가 필드 무시 또는 `400`, 서버가 `msgType='MSG-01'`·`senderRole='ceo'`로 강제 고정
- **매핑**: `conversations.routes.test.ts` `POST /api/conversations/:id/messages — FR-027`(스키마 검증 레벨의 직접 테스트 존재 여부는 §명세 공백 참조)

#### FR-028 의사결정 요청·응답 (Must)

##### TC-IT-034: 등급 높음 → 무기한 대기
- **대상 스토리**: FR-028
- **수용 기준**: Given 등급 '높음' 요청이 발행될 때 When 대표가 응답하기 전이면 Then 해당 Agent는 `waiting` 상태로 대기하고 타임아웃되지 않는다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 등급 `high` 승인 요청 발행
- **테스트 데이터**: `level: "high"`
- **기대 결과**: Agent `waiting`, `waiting_reason: ceo_approval`, `deadline_at: null`
- **매핑**: `tests/unit/backend/services/approval.service.test.ts` `ApprovalService.request — 3분기(R-06·D-10)`, `tests/unit/backend/jobs/approval-timeout.job.test.ts` `ApprovalTimeoutJob.tick — high 등급 제외`

##### TC-IT-035: 등급 보통 → 30분 경과 시 자동 진행
- **대상 스토리**: FR-028
- **수용 기준**: Given 등급 '보통' 요청이 발행될 때 When 30분이 경과하면 Then 자동 진행되고 그 사실이 시스템 이벤트로 기록된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 등급 `medium` 승인 요청, `deadline_at = now + 30분`
- **테스트 데이터**: 시각 조작(now = deadline_at 이후)
- **기대 결과**: `status: auto_advanced`, Agent `waiting→running`, `MSG-05` 시스템 이벤트 기록
- **매핑**: `approval-timeout.job.test.ts` `ApprovalTimeoutJob.tick — 만료된 medium 승인 자동 진행`

##### TC-IT-036: 등급 낮음 → 대화 미노출, 상태 이력에만 기록
- **대상 스토리**: FR-028
- **수용 기준**: Given 등급 '낮음' 결정이 발생할 때 When 처리되면 Then 대화에 노출되지 않고 상태 변경 이력에만 기록된다
- **유형**: Integration
- **기법**: 예외 흐름(비적재)
- **사전 조건**: 등급 `low` 결정 발생
- **테스트 데이터**: `level: "low"`
- **기대 결과**: `approvals`에 적재되지 않음(`400 VALIDATION_ERROR` — low는 적재하지 않는다), 대화에 미표시, 상태 이력에만 기록
- **매핑**: `approval.service.test.ts` `ApprovalService.request — 3분기`, `approvals.routes.test.ts` `POST /api/approvals — R-07`

##### TC-IT-037: 반려 시 사유 미입력이면 거부
- **대상 스토리**: FR-028
- **수용 기준**: Given 대표가 반려할 때 When 사유를 입력하지 않으면 Then 반려가 거부된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: `pending` 승인 건 존재
- **테스트 데이터**: `{status:"rejected", reason: null}`
- **기대 결과**: `400 APPROVAL_REASON_REQUIRED`
- **매핑**: `approval.service.test.ts` `ApprovalService.resolve — 실패 경로 4건(DES-002 §5 순서)`, `approvals.routes.test.ts` `POST /api/approvals/:id/resolve — FR-028`

##### TC-UT-019: 30분 타임아웃 BVA
- **대상 스토리**: FR-028
- **수용 기준**: AC2 확장 — D-10 "30분 후 자동 진행"의 경계
- **유형**: Unit
- **기법**: BVA
- **사전 조건**: `medium` 승인, `deadline_at = created_at + 30분`
- **테스트 데이터**: 현재 시각 = {29분 59초 경과(미만료), 30분 00초 경과(경계, 만료로 처리), 30분 01초 경과(만료)}
- **기대 결과**: 29:59는 `findExpired`에 포함되지 않음, 30:00·30:01은 포함되어 자동 진행
- **매핑**: `tests/unit/backend/repositories/approval.repository.test.ts` `ApprovalRepository.findExpired`(정확한 경계 값 29:59 vs 30:00 케이스 존재 여부는 §명세 공백 참조 — 일반적으로 `deadline_at <= now` 비교로 구현 추정)

##### TC-UT-020: APV-GATE 등급 하향 금지 경계
- **대상 스토리**: FR-028
- **수용 기준**: DES-002 §5 "`approvalType='APV-GATE'`인데 `level≠'high'`" 검증(DB CHECK (4))
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: `{approvalType:"APV-GATE", level:"medium"}`, `{approvalType:"APV-GATE", level:"high"}`
- **기대 결과**: `medium`은 `422 VALIDATION_ERROR`, `high`만 허용
- **매핑**: `migrations.test.ts` `approvals CHECK 5건 — DES-003 §4-1`, `approval-timeout.job.test.ts` `ApprovalTimeoutJob.tick — APV-GATE 이중 방어`

##### TC-UT-021: 반려/조건부 사유 EP 4분류
- **대상 스토리**: FR-028
- **수용 기준**: AC4 확장
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: reason = {null, ""(빈 문자열), "   "(공백 문자열), "정상 사유"}
- **기대 결과**: null·빈 문자열 → `400`, 공백 문자열은 트리밍 처리 여부에 따라 다름(§명세 공백 후보 — trim 정책 미기재), "정상 사유"만 통과
- **매핑**: `approval.service.test.ts` `ApprovalService.resolve — 실패 경로 4건`

##### TC-IT-038: 이미 처리된 승인 재처리 시도
- **대상 스토리**: FR-028
- **수용 기준**: DES-002 §5 "이미 처리된 건인가"
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: `approved`로 이미 처리된 건
- **테스트 데이터**: 동일 건에 재차 `resolve` 요청
- **기대 결과**: `409 APPROVAL_ALREADY_RESOLVED`
- **매핑**: `approval.service.test.ts`, `approvals.routes.test.ts`

#### FR-029 Phase 진행 추적 (Must)

##### TC-IT-039: 진행 현황 조회 시 7단계 상태·산출물·승인대기 건수 반환
- **대상 스토리**: FR-029
- **수용 기준**: Given Phase가 진행 중일 때 When 진행 현황을 조회하면 Then 7개 단계(plan~operate)별 상태·산출물 건수·승인 대기 건수가 반환된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: Phase 1 부트스트랩 완료
- **테스트 데이터**: -
- **기대 결과**: `stages` 7건, 각 `status/artifactCount/pendingApprovalCount` 포함
- **매핑**: `tests/unit/backend/services/phase.service.test.ts` `PhaseService.getCurrent`, `tests/unit/backend/routes/phases.routes.test.ts` `GET /api/phases/current`, `tests/unit/backend/repositories/phase.repository.test.ts` `PhaseRepository.findStagesWithAggregates`

##### TC-UT-022: WIP=1 경계 BVA
- **대상 스토리**: FR-029
- **수용 기준**: Given 앞 단계가 완료되지 않았는데 다음 단계가 진행 중일 때 When 진행 현황을 조회하면 Then WIP 위반이 근거 수치와 함께 표시된다
- **유형**: Unit
- **기법**: BVA
- **사전 조건**: -
- **테스트 데이터**: 동시 `in_progress` 단계 수 = {0건(위반 아님), 1건(경계, 정상), 2건(위반), 3건(위반)}
- **기대 결과**: 0·1건은 `wipViolations: []`, 2건 이상은 위반 목록에 상세 근거 포함
- **매핑**: `phase.service.test.ts` `PhaseService.checkWip`, `phase.repository.test.ts` `PhaseRepository.countInProgressStages`

##### TC-IT-040: WIP 위반 무시 등록 시 해당 Phase 동안 재표시 안 됨
- **대상 스토리**: FR-029
- **수용 기준**: Given WIP 위반을 무시하기로 할 때 When 사유와 함께 등록하면 Then 해당 Phase 동안 다시 표시되지 않는다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: WIP 위반 상태
- **테스트 데이터**: `POST /api/wip-waivers {reason:"설계 개정과 API 명세 병행"}`
- **기대 결과**: 이후 `GET /api/phases/current` 조회 시 해당 위반 `waived: true`로 미노출 또는 표시만 되고 경고 없음
- **매핑**: `phase.service.test.ts` `PhaseService.createWaiver`, `phase.repository.test.ts` `PhaseRepository.findWaiver · insertWaiver`, `phases.routes.test.ts` `POST /api/wip-waivers`

##### TC-UT-023: 면제 사유 필수값 EP
- **대상 스토리**: FR-029
- **수용 기준**: DES-002 §5 `POST /api/wip-waivers` "`reason`은 필수다. 빈 문자열이면 `400`"
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: reason = {undefined, ""(빈 문자열), "정상 사유"}
- **기대 결과**: undefined·빈 문자열 → `400 VALIDATION_ERROR`, 정상 문자열만 통과
- **매핑**: `phases.routes.test.ts` `POST /api/wip-waivers`

#### FR-030 스킬 전환 승인 게이트 (Must)

##### TC-IT-041: 게이트 지점 도달 시 승인 없이 차단 + 승인 요청 생성
- **대상 스토리**: FR-030
- **수용 기준**: Given 게이트 지점에 도달할 때 When 다음 단계 착수를 요청하면 Then 승인 없이는 차단되고 승인 요청이 생성된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: `plan` 완료, `analyze` 착수 시도, `APV-GATE` 미승인
- **테스트 데이터**: `POST /api/stages/:analyzeId/start`
- **기대 결과**: `403 GATE_NOT_PASSED`
- **매핑**: `tests/unit/backend/services/stage.service.test.ts` `StageService.start — 가드 2: 승인 게이트`, `tests/unit/backend/routes/stages.routes.test.ts` `POST /api/stages/:id/start — FR-030 3단 가드`

##### TC-IT-042: 게이트 승인 요청 시 직전 단계 산출물 전체 제시
- **대상 스토리**: FR-030
- **수용 기준**: Given 게이트 승인 요청이 생성될 때 When 대표가 조회하면 Then **직전 단계 산출물 전체**가 검토 대상으로 함께 제시된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: `APV-GATE` 발행됨
- **테스트 데이터**: `GET /api/approvals/:id`
- **기대 결과**: `artifacts[]`에 직전 단계 산출물 코드·Git 경로·Notion URL·동기화 상태 포함
- **매핑**: `approval.service.test.ts` `ApprovalDetail.artifacts — §3 스텁 교체 회귀 테스트(Layer 2-9)`, `approvals.routes.test.ts` `GET /api/approvals/:id — FR-028`

##### TC-IT-043: 게이트 대기 중 시간 경과해도 자동 진행 안 됨
- **대상 스토리**: FR-030
- **수용 기준**: Given 게이트 승인 요청이 대기 중일 때 When 시간이 경과해도 Then 자동 진행되지 않는다 (타임아웃 없음)
- **유형**: Integration
- **기법**: 예외 흐름(부정 검증)
- **사전 조건**: `APV-GATE` `pending`, 임의 시간 경과
- **테스트 데이터**: -
- **기대 결과**: `ApprovalTimeoutJob.tick` 실행해도 `APV-GATE`는 대상에서 제외(`deadline_at: null`이라 조회에 잡히지 않음)
- **매핑**: `approval-timeout.job.test.ts` `ApprovalTimeoutJob.tick — APV-GATE 이중 방어`

##### TC-UT-024: 체크리스트 미완료 시 승인 버튼 비활성 (명세 공백)
- **대상 스토리**: FR-030
- **수용 기준**: Given 대표가 승인할 때 When 검토 체크리스트를 모두 완료하지 않았으면 Then 승인 버튼이 활성화되지 않는다
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: -
- **기대 결과**: (명세 공백 — 아래 §명세 공백 참조)
- **미커버**: DES-002 API 명세·DES-006 CLI 화면 명세 어디에도 "체크리스트" 항목의 데이터 구조·검증 엔드포인트가 정의되어 있지 않다. CLI는 GUI 버튼이 없으므로 이 수용 기준이 CLI에 어떻게 매핑되는지 근거 문서에 공백이 있다.

##### TC-IT-044: 게이트 예외 승인 시 사유 기록 + 진행 허용
- **대상 스토리**: FR-030
- **수용 기준**: Given 게이트를 우회해야 할 때 When 예외 승인을 요청하면 Then 사유와 함께 기록되고 진행이 허용된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: WIP 위반 상태에서 예외 진행 필요
- **테스트 데이터**: `POST /api/approvals {approvalType:"APV-GATE", rationale:"..."}` 또는 `POST /api/wip-waivers`
- **기대 결과**: 사유 기록 + 이후 착수 허용
- **매핑**: `approvals.routes.test.ts` `POST /api/approvals — R-07`, `phases.routes.test.ts` `POST /api/wip-waivers`

##### TC-UT-025: 3단 가드 조합 EP
- **대상 스토리**: FR-030
- **수용 기준**: DES-007 §7-1 3단 검증(직전 완료·게이트 통과·WIP)
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: {가드1 실패(직전 미완료), 가드2 실패(게이트 미승인), 가드3 실패(WIP 위반·면제 없음), 전건 통과}
- **기대 결과**: 순서대로 `422 INVALID_TRANSITION` / `403 GATE_NOT_PASSED` / `409 WIP_VIOLATION` / `200` + `in_progress`
- **매핑**: `stage.service.test.ts` `StageService.start — 가드 1/2/3`, `stages.routes.test.ts` `POST /api/stages/:id/start — FR-030 3단 가드`

##### TC-ST-004: plan 완료 → 게이트 승인 → analyze 착수 전체 흐름
- **대상 스토리**: FR-030
- **수용 기준**: FR-030 전체 AC 통합 시나리오
- **유형**: E2E
- **기법**: 정상 흐름
- **사전 조건**: `plan` 단계 `in_progress`
- **테스트 데이터**: `POST /api/stages/:planId/complete` → `POST /api/approvals/:gateId/resolve {status:"approved"}` → `POST /api/stages/:analyzeId/start`
- **기대 결과**: `plan: completed` → 게이트 `approved`(단, `stages` 미변경) → `analyze: in_progress`
- **매핑**: `stages.routes.test.ts` `플로우 회귀 — plan 착수 → 완료 → analyze 착수(Layer 2-8 보완의 방어선)`, `cli/commands/progress.test.ts` `플로우 통합 — start → complete → 다음 start`

#### FR-031 산출물 동기화 추적 (Should, 구현됨)

##### TC-UT-026: syncStatus 4분류 EP
- **대상 스토리**: FR-031
- **수용 기준**: Given 산출물 목록을 조회할 때 When 각 산출물에 대해 Then Notion URL과 Git 경로의 존재 여부가 표시된다
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: {notionUrl+gitPath 모두 존재(synced), notionUrl만(notion_only), gitPath만(git_only), 둘 다 없음(missing)}
- **기대 결과**: 4분류가 정확히 파생됨
- **매핑**: `tests/unit/backend/services/artifact.service.test.ts` `deriveSyncStatus — 4분기 전건(DES-003 §4-4, FR-031 회귀 방어선)`, `tests/unit/backend/repositories/artifact.repository.test.ts` `ArtifactRepository.findMany — syncStatus 4분기(DES-003 §4-4)`

##### TC-IT-045: 한쪽만 존재하는 산출물 미동기화 표시
- **대상 스토리**: FR-031
- **수용 기준**: Given 한쪽에만 존재하는 산출물이 있을 때 When 목록을 조회하면 Then 미동기화 항목으로 구분 표시된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: `notion_only` 산출물 1건 존재
- **테스트 데이터**: `GET /api/artifacts?syncStatus=notion_only`
- **기대 결과**: 필터 결과에 해당 건만 반환
- **매핑**: `tests/unit/backend/routes/artifacts.routes.test.ts` `GET /api/artifacts — FR-031`

---

### Layer 6 — CLI 연동

#### INT-001 CLI-백엔드 HTTP 통신 (Must)

##### TC-IT-046: CLI 명령 실행 시 백엔드 API 호출 + 결과 표시
- **대상 스토리**: INT-001
- **수용 기준**: Given CLI가 설치되고 백엔드가 실행 중일 때 When CLI 명령을 실행하면 Then 백엔드 API가 호출되고 결과가 표시된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 백엔드 실행 중, 인증됨
- **테스트 데이터**: `cm project list`
- **기대 결과**: API 호출 후 표 형태 출력
- **매핑**: `tests/unit/cli/api-client.test.ts` `ApiClient — 성공 응답`, `tests/unit/cli/commands/project.test.ts` `runProjectList`

##### TC-IT-047: 백엔드 미기동 시 연결 불가 에러
- **대상 스토리**: INT-001
- **수용 기준**: Given 백엔드가 실행 중이지 않을 때 When CLI 명령을 실행하면 Then "서버에 연결할 수 없습니다" 에러가 표시된다
- **유형**: Integration
- **기법**: 예외 흐름
- **사전 조건**: 백엔드 미기동
- **테스트 데이터**: 임의 명령
- **기대 결과**: "서버에 연결할 수 없습니다" 메시지 + 종료 코드 비정상
- **매핑**: `api-client.test.ts` `ApiClient — 서버 미기동`, `tests/unit/cli/runtime.test.ts` `checkAuth`

#### INT-003 CLI 대화·승인 명령 (Must)

##### TC-IT-048: 대화 명령 실행 시 Main·Agent와 대화
- **대상 스토리**: INT-003
- **수용 기준**: Given CLI에서 인증된 상태일 때 When 대화 명령을 실행하면 Then Main·Agent와 대화할 수 있다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 인증됨
- **테스트 데이터**: `cm chat main`, `cm chat agent <id>`
- **기대 결과**: REPL 진입, 발화·응답 왕복
- **매핑**: `tests/unit/cli/commands/chat.test.ts` `runChatMainOpen`, `runChatAgentOpen`, `runChatRepl`, `runChatSend`

##### TC-IT-049: 미응답 승인 목록에 등급·안건·경과·기한 표시
- **대상 스토리**: INT-003
- **수용 기준**: Given 미응답 승인 요청이 있을 때 When 목록 명령을 실행하면 Then 등급·안건·경과 시간·기한이 표시된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: `pending` 승인 1건 이상
- **테스트 데이터**: `cm inbox`
- **기대 결과**: 등급·안건·경과·잔여(기한) 컬럼 표시
- **매핑**: `tests/unit/cli/commands/approval.test.ts` `runInbox`

##### TC-IT-050: 승인 건 상세에 안건·산출물·근거·영향 범위 출력
- **대상 스토리**: INT-003
- **수용 기준**: Given 승인 건을 검토할 때 When 상세 명령을 실행하면 Then 안건·산출물·근거·영향 범위가 출력된다
- **유형**: Integration
- **기법**: 정상 흐름
- **사전 조건**: 승인 건 존재
- **테스트 데이터**: `cm review <id>`
- **기대 결과**: 안건·선택지·산출물(동기화 상태 포함)·근거·영향 범위 전부 출력
- **매핑**: `approval.test.ts` `runReview`

#### NFR-003 실시간 메시지 전달 (Should, 구현됨)

##### TC-PT-002: 새 메시지 3초 이내 전달
- **대상 스토리**: NFR-003
- **수용 기준**: Given 새 메시지가 발생할 때 When 클라이언트가 연결되어 있으면 Then 3초 이내에 전달된다
- **유형**: E2E (성능)
- **기법**: BVA
- **사전 조건**: WS 클라이언트 연결됨
- **테스트 데이터**: 경계값 — 2.99s(통과) / 3.00s(경계) / 3.01s(실패)
- **기대 결과**: 3초 이내 전달률 100%
- **미커버**: `tests/unit/backend/ws/hub.test.ts`는 브로드캐스트 로직(채널 라우팅, 출력 전용, 종료)만 검증하고 전달 소요 시간을 측정하지 않는다.

##### TC-UT-027: 연결 상태 EP + 누락 보충
- **대상 스토리**: NFR-003
- **수용 기준**: Given 연결이 끊어질 때 When 재연결되면 Then 누락된 메시지가 조회로 보충된다
- **유형**: Unit
- **기법**: EP
- **사전 조건**: -
- **테스트 데이터**: {연결 유지, 연결 끊김→재연결}
- **기대 결과**: 재연결 시 REST `GET /api/conversations/:id/messages`로 누락분 보충(WS는 버퍼링하지 않음)
- **매핑**: `hub.test.ts` `WebSocketHub — 채널 브로드캐스트`(재연결 후 REST 보충 자체를 검증하는 전용 테스트는 확인되지 않음 — CLI 측 `chat.test.ts`의 REPL 재연결 로직도 별도 확인 필요)

---

## BVA/EP 적용 요약

| 스토리 | 경계값 | 동치 클래스 | 추가 케이스 수 |
|--------|--------|------------|:---:|
| FR-004 | pageSize {1, 20, 100, 101} | 정상/초과 | 2 |
| FR-005 | ID 축약 조회 | {전체UUID, 고유8자, 충돌8자, 미존재} | 1 |
| FR-006 | 종료 상태(completed/cancelled) | 상태 8종 × 허용/불허 전이 | 2 |
| FR-007 | 재시도 횟수 {0~2 허용, 3 차단}(명세 공백) | 상태 7종 × 허용/불허 전이 | 2 |
| FR-008 | in_progress→completed 직접 전이 금지 | 상태 8종 × 허용/불허 전이 | 2 |
| FR-009 | - | 이력 건수 {0, 1, 다수} | 1 |
| FR-026 | - | 채널 상태 3종 × {발화,조회,검색} | 1 |
| FR-027 | 본문 길이 {0,1,10000,10001}, 검색어 길이 {0,1,2}, limit {0,1,50,100,101} | - | 4 |
| FR-028 | 30분 타임아웃 {29:59, 30:00, 30:01}, APV-GATE 등급 하향 금지 | 반려 사유 {null,빈,공백,정상} | 4 |
| FR-029 | WIP=1 {0,1,2,3} | 면제 사유 {undefined,빈,정상} | 2 |
| FR-030 | - | 3단 가드 조합 4분류, 체크리스트(명세 공백) | 2 |
| FR-031 | - | syncStatus 4분류 | 1 |
| NFR-001 | 응답시간 {2.99s,3.00s,3.01s} | - | 1(성능) |
| NFR-003 | 전달시간 {2.99s,3.00s,3.01s} | 연결 상태 2종 | 2 |

---

## 기존 단위 테스트 매핑

> `tests/unit/**` 59개 파일(테스트 없는 `.gitkeep` 제외 58개) 기준. 요구사항 코드가 파일의 `describe` 블록에 명시적으로 표기된 경우 우선 인용했다.

| 요구사항 | 매핑 테스트 파일 | 커버 여부 |
|---------|-----------------|----------|
| FR-001 | `backend/routes/health-auth.routes.test.ts`(`GET /api/health`, `부팅 — DAT-001·DAT-002`) | 부분 — SIGTERM 종료, DB 연결 실패 시작 중단 미커버 |
| NFR-001 | (해당 없음) | **미커버** — 성능 측정 테스트 파일 없음 |
| DAT-001 | `backend/db/migrations.test.ts`, `backend/routes/health-auth.routes.test.ts` | 부분 — 재시작 지속성은 E2E(UAT)로만 검증 가능 |
| DAT-002 | `backend/db/migrations.test.ts`, `backend/db/schema.test.ts` | 부분 — 마이그레이션 실패·롤백 경로 미커버 |
| FR-002 | `backend/services/auth.service.test.ts`, `backend/routes/health-auth.routes.test.ts`, `cli/commands/auth.test.ts` | 완전 |
| NFR-002 | `backend/routes/health-auth.routes.test.ts`(`인증 미들웨어 — NFR-002`) | 완전 |
| FR-003 | `backend/services/project.service.test.ts`, `backend/routes/projects.routes.test.ts`, `backend/repositories/project.repository.test.ts` | 완전 |
| FR-004 | 위와 동일 | 완전(단, pageSize 경계값 직접 테스트는 재확인 필요) |
| FR-005 | 위와 동일 + `cli/runtime.test.ts`(`resolveId` 등) | 완전 |
| FR-006 | 위와 동일 + `shared/state-transitions.test.ts`(`Project 상태 머신`) | 완전 |
| FR-007 | `backend/services/agent.service.test.ts`, `backend/routes/agents.routes.test.ts`, `backend/repositories/agent.repository.test.ts`, `backend/services/agent-atomicity.test.ts` | 부분 — 재시도 횟수 상한(3) 경계값 직접 테스트 미확인 |
| FR-008 | `backend/services/task.service.test.ts`, `backend/routes/tasks.routes.test.ts`, `backend/repositories/task.repository.test.ts` | 완전 |
| FR-009 | `backend/services/status-change.service.test.ts`, `backend/routes/status-changes.routes.test.ts`, `backend/repositories/status-change.repository.test.ts` | 완전 |
| DAT-003 | `backend/db/migrations.test.ts`(`approvals CHECK 5건`), `backend/db/schema.test.ts` | 부분 — 재시작 지속성은 E2E로만 검증 |
| FR-026 | `backend/services/conversation.service.test.ts`(`createForAgent`, `markReadonly`, `ensureMainChannel`), `backend/bootstrap/bootstrap.service.test.ts`, `shared/state-transitions.test.ts`(채널 상태 머신) | 부분 — Sub-Agent 채널 미노출 규칙은 아키텍처적으로 암묵 준수(직접 테스트 없음) |
| FR-027 | `backend/repositories/message.repository.test.ts`, `backend/services/conversation.service.test.ts`, `backend/routes/conversations.routes.test.ts`, `backend/repositories/conversation-project-filter.test.ts` | 부분 — 본문/검색어 길이 경계값 직접 테스트 재확인 필요, 재시작 지속성 미커버 |
| FR-028 | `backend/services/approval.service.test.ts`, `backend/routes/approvals.routes.test.ts`, `backend/repositories/approval.repository.test.ts`, `backend/jobs/approval-timeout.job.test.ts`, `backend/services/approval-atomicity.test.ts` | 완전(30분 경계 정밀 케이스는 재확인 권장) |
| FR-029 | `backend/services/phase.service.test.ts`, `backend/routes/phases.routes.test.ts`, `backend/repositories/phase.repository.test.ts`, `backend/services/phase-atomicity.test.ts` | 완전 |
| FR-030 | `backend/services/stage.service.test.ts`, `backend/routes/stages.routes.test.ts`, `backend/services/stage-atomicity.test.ts` | 부분 — 체크리스트 완료 강제(AC4) 미커버(명세 공백) |
| FR-031 | `backend/services/artifact.service.test.ts`, `backend/routes/artifacts.routes.test.ts`, `backend/repositories/artifact.repository.test.ts` | 완전 |
| INT-001 | `cli/api-client.test.ts`, `cli/runtime.test.ts` | 완전 |
| INT-003 | `cli/commands/chat.test.ts`, `cli/commands/approval.test.ts`, `cli/commands/progress.test.ts` | 완전 |
| NFR-003 | `backend/ws/hub.test.ts`, `backend/services/conversation-unread.test.ts` | 부분 — 3초 전달 시간 자체 미커버, 재연결 보충 전용 테스트 미확인 |

### 참고 — 요구사항 범위 외 테스트 파일

`shared/constants.test.ts`(DES-009 상수), `backend/config.test.ts`(설정 로딩), `backend/utils/state-machine.test.ts`(전이 검증 유틸), `backend/utils/errors.test.ts`(에러 응답 포맷), `cli/output.test.ts`(출력 포맷 유틸), `cli/config.test.ts`(CLI 설정 파일), `cli/index.test.ts`(CLI 진입점)는 특정 요구사항 코드에 1:1 대응하지 않는 공통 유틸/인프라 테스트로, 위 매핑 표에서 제외했다.

---

## 명세 공백

근거 문서에 수치·규칙이 없어 케이스를 확정하지 못한 항목이다. develop/조사 단계에서 보완이 필요하다.

| # | 항목 | 공백 내용 | 관련 스토리 |
|---|------|----------|------------|
| 1 | Agent 재시도 상한 | PLN-001 FR-007 수용 기준에는 재시도 횟수 상한이 명시되어 있지 않다. DES-006 SCR-AG03에서만 "재시도 n/3" 표시가 확인되나, 상한 "3"의 근거(어느 설계/요구사항 문서에서 확정했는지)와 3회 도달 시 정확한 동작(완전 차단인지, cancelled로 자동 전이인지)이 문서화되어 있지 않다 | FR-007 |
| 2 | 서버 프로세스 SIGTERM 처리 상세 | FR-001 AC2는 "진행 중인 요청을 완료한 후 정상 종료"만 규정한다. DES-005 스토리보드는 예시로 "타임아웃 10초"를 보여주지만 이것이 확정 수용 기준인지 스토리보드 예시 연출인지 불명확하다 | FR-001 |
| 3 | 마이그레이션 실패 시 롤백 상세 절차 | DAT-002 AC2는 "롤백되고 에러가 보고된다"고만 규정한다. 부분 적용된 마이그레이션 파일 내 여러 DDL 문 중 일부만 성공했을 때의 트랜잭션 경계, 재시작 시 재시도 정책은 문서에 없다 | DAT-002 |
| 4 | 승인 게이트 "체크리스트" 데이터 구조 | FR-030 AC4는 "검토 체크리스트를 모두 완료하지 않았으면 승인 버튼이 활성화되지 않는다"고 규정하나, DES-002(API 명세)·DES-006(CLI 화면 명세) 어디에도 "체크리스트" 항목을 저장·조회·검증하는 엔드포인트나 CLI 프롬프트가 정의되어 있지 않다. CLI에는 버튼 개념이 없어(DES-006 §1 GUI/CLI 대응표) 이 수용 기준이 `cm decide`의 어느 동작에 대응하는지도 불명확하다 | FR-030 |
| 5 | 프로젝트/Agent/Task 이름·설명 문자열 길이 제한 | PLN-001·DES-002 어디에도 `name`·`description` 필드의 최대 길이 제약이 명시되어 있지 않다(메시지 본문만 minLength/maxLength가 명시됨). 따라서 이 필드들에 대한 BVA 케이스는 만들지 않았다 | FR-003, FR-007, FR-008 |
| 6 | 반려/조건부 사유의 공백 문자열 처리 | DES-002 §6-4는 `reason`에 `minLength: 1`을 요구하나, 공백만으로 이루어진 문자열(`"   "`)이 trim 후 검증되는지(길이 0으로 취급) 여부가 명시되어 있지 않다 | FR-028 |
| 7 | Sub-Agent 대화 채널 비노출 규칙의 구현 근거 | FR-026 AC4(그래프 규칙 3)는 요구사항 수준에서 명시되나, Phase 1 데이터 모델(DES-003, 본 문서 읽기 대상 외)에 "Sub-Agent"가 `agents`와 별도 엔티티로 존재하는지, 아니면 `type` 필드로만 구분되는지가 참조 문서 범위 내에서는 확인되지 않았다 | FR-026 |

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| **v1.1** | 2026-09-03 | **문서 정리 마감 — test 9단계 수정 루프 2차.** §범위에 **커버리지 공백 각주 신설** — D-2·D-3 신설분(`PATCH /api/conversations/:id/read`·`POST /api/artifacts`·SCR-CH15)이 케이스 본문에 TC 항목으로 없음을 명시, 단위·통합 테스트는 dev-sub 병렬 반영으로 커버됨을 밝히고 UAT 보강은 다음 루프로 이월. 케이스 본문·커버리지 수치는 변경 없음 |
| v1 | 2026-09-03 | 최초 작성. Phase 1 Must 19건 + 구현된 Should 4건(FR-005·031·NFR-001·003)을 대상으로 TC-UT/IT/ST/PT/SE 86건 작성. BVA/EP 적용 요약, 기존 단위 테스트 매핑, 명세 공백 7건 포함 |
