# ANL-004 기술 스택 결정서

> Phase 1: 기반 구축
> 분석 기준 브랜치: main (commit d79f5c5)
> 작성일: 2026-08-23
> **원본**: [Notion ANL-004](https://app.notion.com/p/3c5d066504ec81d2837cc61941e44e08) · Git 동기화 2026-09-01
> 기준 원본 정책: Notion = 대표 승인 원본 / Git = 에이전트 실행 원본. 충돌 시 Notion 우선.

---

## 확정 사항 (이전 결정)

| 영역 | 기술 | 결정 시점 | 근거 |
|------|------|----------|------|
| 데이터베이스 | SQLite | plan | 1인 사용자, 로컬 실행, 파일 기반 간편 |
| API 통신 | REST + WebSocket | plan | REST=CRUD, WS=실시간(Phase 2) |
| 실행 환경 | MacBook 로컬 | plan | MVP 범위, 단일 사용자 |
| 배포 형태 | 웹앱(로컬 백엔드 + 웹 UI) + CLI | plan | Phase 1은 CLI, Phase 2에서 웹 UI |

---

## 신규 결정

### ADR-001: 백엔드 프레임워크

- **상태**: 제안 (자동 선택 — 평가 매트릭스 1위)
- **날짜**: 2026-08-23
- **결정자**: 자율 판단 (의사결정 등급: 보통)

**맥락**: Phase 1의 12개 Must 스토리는 REST API 서버를 필요로 한다. AI 에이전트가 코드를 생성하므로 프레임워크의 AI 코딩 호환성이 중요하다.

**후보**: Fastify, Express, Hono (모두 Node.js/TypeScript)

| 기준 (가중치) | Fastify | Express | Hono |
|--------------|:---:|:---:|:---:|
| 학습 곡선 (×2) | 4 | 5 | 4 |
| 생태계/플러그인 (×2) | 5 | 5 | 3 |
| 성능 (×1) | 4 | 3 | 5 |
| 커뮤니티 규모 (×1) | 4 | 5 | 3 |
| 프로젝트 적합성 (×3) | 5 | 4 | 4 |
| AI 코딩 호환성 (×2) | 5 | 5 | 4 |
| **가중 합계** | **51** | **50** | **42** |

**결정**: **Fastify (TypeScript)** — 스키마 기반 검증, 플러그인 아키텍처, Express 대비 2배 성능
**기각**: Express(스키마 검증 미내장), Hono(로컬 서버에 Edge 최적화 불필요)

---

### ADR-002: 프론트엔드 프레임워크

- **상태**: 제안 (Phase 2용이나 구조 결정 필요)
- **날짜**: 2026-08-23

**후보**: React (Vite), Vue (Vite), Svelte (SvelteKit)

| 기준 (가중치) | React | Vue | Svelte |
|--------------|:---:|:---:|:---:|
| 학습 곡선 (×2) | 4 | 5 | 5 |
| 생태계/플러그인 (×2) | 5 | 4 | 3 |
| 성능 (×1) | 3 | 4 | 5 |
| 커뮤니티 규모 (×1) | 5 | 3 | 2 |
| 프로젝트 적합성 (×3) | 4 | 4 | 4 |
| AI 코딩 호환성 (×2) | 5 | 4 | 3 |
| **가중 합계** | **48** | **45** | **41** |

**결정**: **React + Vite (TypeScript)** — AI 코딩 호환성 최고, 생태계 압도적

---

### ADR-003: CLI 프레임워크

- **상태**: 제안
- **날짜**: 2026-08-23

**후보**: Commander, Yargs, Oclif

| 기준 (가중치) | Commander | Yargs | Oclif |
|--------------|:---:|:---:|:---:|
| 학습 곡선 (×2) | 5 | 4 | 3 |
| 생태계/플러그인 (×2) | 4 | 4 | 3 |
| 성능 (×1) | 5 | 4 | 3 |
| 커뮤니티 규모 (×1) | 5 | 4 | 2 |
| 프로젝트 적합성 (×3) | 5 | 4 | 2 |
| AI 코딩 호환성 (×2) | 5 | 4 | 3 |
| **가중 합계** | **53** | **44** | **29** |

**결정**: **Commander** — 0 의존성, 22ms 시작, 프로젝트 규모에 최적

---

### ADR-004: Agent 프로세스 감지 방식 (Spike)

- **상태**: 제안 (spike 결론)
- **날짜**: 2026-08-23

**후보**: Claude Code Hooks, OS-level Polling, 수동 등록

**결정**: **Claude Code Hooks** 권장. Phase 1은 수동 등록(FR-007)으로 시작, FR-011 구현 시 Hooks 적용.

**근거**: 공식 지원 메커니즘, 이벤트 기반(실시간, 리소스 소모 없음), settings.json 설정만으로 동작.

---

## 보조 기술 결정

- **SQLite 드라이버**: better-sqlite3 — 동기식 API, node-sqlite3 대비 2~5배 성능
- **ORM**: Drizzle ORM — TypeScript-first, 스키마→타입 자동 추론, 마이그레이션 자동
- **빌드**: Vite(프론트엔드), tsx(개발), tsup(배포)

## 기술 스택 요약

| 영역 | 기술 | ADR | 상태 |
|------|------|-----|------|
| 언어 | TypeScript (Node.js) | — | 확정 |
| 백엔드 | Fastify 5 | ADR-001 | 제안 |
| 프론트엔드 | React + Vite | ADR-002 | 제안 |
| CLI | Commander | ADR-003 | 제안 |
| DB | SQLite (better-sqlite3) | (기확정) | 확정 |
| ORM | Drizzle ORM | — | 제안 |
| 통신 | REST + WebSocket | (기확정) | 확정 |
| Agent 감지 | Claude Code Hooks | ADR-004 | 제안 (spike) |

---

## ⚠ 2026-09-01 승인 반영 — 스택 추가 확정

`docs/00-approvals.md` 전건 승인으로 아래가 추가 확정되었다. **ADR로 정식 편입 필요.**

| 영역 | 기술 | 근거 결정 | ADR 신규 |
|------|------|----------|:---:|
| CSS 프레임워크 | **Tailwind CSS** | DES-010 기확정 | ADR-006 |
| UI 컴포넌트 | **shadcn/ui** | **D-03** — 코드 소유권 보유, Tailwind 정합, Resizable·Command·DataTable 모두 존재 | ADR-007 |
| 커맨드 팔레트 | **cmdk** | **D-04** | ADR-007에 포함 |
| 데이터 테이블 | **TanStack Table** | D-03 (shadcn/ui 기본 채택) | ADR-007에 포함 |
| 모바일 | **PWA** (별도 스택 없음, 웹과 동일 코드베이스) | **D-20** | ADR-008 |
| 푸시 | **Web Push (VAPID)** + `web-push` 서버 라이브러리 | **D-21** (APV-EXT 외부 연동) | ADR-009 |
| 생체인증 | **WebAuthn** (platform authenticator) | **D-22** | ADR-009에 포함 |
| 원격 접속 | **터널링** — Tailscale 또는 Cloudflare Tunnel (**고정 도메인 필수**) | **D-19** (APV-EXT 외부 연동) | ADR-010 |
| 전문 검색 | **SQLite FTS5** | **D-27** (대화 아카이브 검색) | ADR-011 |

---

## ADR-010: 터널 제품 선택 (D-19 후속)

- **상태**: 제안 — **대표 결정 필요**
- **날짜**: 2026-09-01
- **의사결정 등급**: 높음 (외부 서비스 연동 = APV-EXT)

### 맥락

D-19에서 "터널링"이 승인되었으나 **어느 제품을 쓸지는 정해지지 않았다.** 선택 기준은 3가지다.

1. **고정 도메인** — WebAuthn(생체인증)은 도메인이 바뀌면 등록한 passkey가 무효가 된다 (DES-015 §6-4)
2. **HTTPS** — Service Worker·Web Push·WebAuthn 전부 필수 (DES-015 §2-2)
3. **노출 범위** — RISK-011(터널 노출로 인한 공격면 확대) 완화

### 🔴 라이선스 확인 결과 (2026-09-01) — 권고 뒤집힘

<!-- 초안에서 Tailscale 무료를 권고했으나 약관 확인 후 뒤집었다 -->
**Tailscale Personal 플랜은 상업적 사용이 명시적으로 금지되어 있다.**

> *"The Personal plan is not intended for commercial use… only suitable for non-commercial use of Tailscale."* — [Tailscale 무료 플랜 문서](https://tailscale.com/docs/account/manage-plans/free-plans-discounts)

ClaudeManager는 대표의 **사업 운영 도구**이므로 상업적 사용에 해당한다. 따라서 **Tailscale 무료 플랜은 이 프로젝트에 쓸 수 없다.**

- Tailscale은 계정 도메인으로 개인/사업을 자동 판별한다. Gmail 등 공개 도메인 → Personal(무료), 커스텀 도메인 → 사업용(14일 체험 후 유료)
- 이 판정을 우회해 무료 플랜을 쓰는 것은 약관 위반이다

**결과: 비용 비교가 역전된다.** 초안에서 "Tailscale 무료 vs Cloudflare 도메인 구매 필요"로 봤으나, 실제로는 **Tailscale이 유료, Cloudflare가 무료**다.

### 소프트웨어 라이선스

| 구성요소 | 라이선스 | 비고 |
|---------|---------|------|
| Tailscale 클라이언트 (`tailscaled`, CLI) | BSD-3-Clause | 오픈소스 |
| Tailscale **컨트롤 플레인** | **독점 (SaaS 전용)** | 자체 호스팅 불가 → 유료 구독이 필요한 이유 |
| `cloudflared` | **Apache-2.0** | 오픈소스 |
| Cloudflare Tunnel 서비스 | 독점 (SaaS) | Zero Trust 무료 티어에 **상업 사용 제한 없음** |
| **Headscale** (Tailscale 컨트롤 플레인 오픈소스 재구현) | **BSD-3-Clause** | 자체 호스팅. 공식 Tailscale 클라이언트를 그대로 사용 |

### 비교 (라이선스 반영)

| 기준 | **Tailscale** | **Cloudflare Tunnel** | **Headscale** (제3안) |
|------|--------------|----------------------|---------------------|
| **상업 사용** | ⚠️ **무료 플랜 불가** → 유료 필수 | ✅ 무료 티어로 가능 | ✅ 오픈소스, 제한 없음 |
| **비용** | **유료** (사용자당 월 $6~ 수준, 가입 시 확인) | 무료 + **도메인 구매** (연 1~2만원) | 무료. 단 컨트롤 서버 운영 부담 |
| **고정 도메인** | ✅ `<기기명>.<테일넷>.ts.net` — 도메인 불필요 | ⚠️ **자기 도메인이 있어야** 고정됨.<br>없으면 `trycloudflare.com` 랜덤 주소 → **재시작마다 바뀜 → WebAuthn 불가** |
| **HTTPS** | ✅ Let's Encrypt 자동 (`tailscale cert`) | ✅ 자동 |
| **노출 범위** | ✅ **내 기기만** (private tailnet). 인터넷에 안 뜸 | ⚠️ **공개 인터넷**. 막으려면 Cloudflare Access 별도 설정 |
| **설정 난이도** | 낮음 — PC·폰에 앱 설치 후 로그인, `tailscale serve` 1줄 | 중간 — 도메인 등록 → cloudflared 설치 → 터널 생성 → DNS 연결 (12단계) |
| **폰 준비물** | **Tailscale 앱 설치 + 로그인 필요** | 없음 (브라우저만) |
| **PC 꺼지면** | 접속 불가 (동일) | 접속 불가 (동일) |

### 🔴 재검토 — 비용 제약 (2026-09-01)

**대표 제약: 비용이 발생하면 안 된다.** → Tailscale 유료 플랜 제외. 아래 확정은 보류한다.

#### 다시 본 사실: Phase 1에는 터널이 필요 없다

| Phase | 인터페이스 | 터널 필요? |
|:---:|----------|:---:|
| **Phase 1** | CLI + API (같은 PC에서 실행) | **❌ 불필요** — `127.0.0.1`로 충분 |
| Phase 2 | 웹 대시보드 + 모바일 웹(PWA) | ✅ 필요 |

터널은 **모바일에서 접속하기 위한 것**이고, 모바일 웹은 D-23 승인에 따라 **Phase 2**다.
따라서 **D-19·D-29는 지금 결정하지 않아도 Phase 1 진행에 지장이 없다.** Phase 2 착수 시점으로 미룬다.

#### 비용 0 선택지 (Phase 2 시점에 재평가)

| 안 | 비용 | 조건 | 평가 |
|---|------|------|------|
| **Cloudflare Tunnel** | **0원** — 이미 도메인을 보유한 경우 | 도메인 필요 (신규 구매 시 연 1~2만원) | 도메인이 있으면 **최선** |
| **Headscale** 자체 호스팅 | 0원 (BSD-3) | 컨트롤 서버를 둘 곳이 필요 — 순환 문제 | 1인 운영에 부담 |
| Tailscale Personal | 0원 | **상업 사용 금지** | ❌ 약관 위반 |
| Tailscale 유료 | 유료 | — | ❌ 비용 제약 |
| LAN 바인딩 (D-19 A안) | 0원 | HTTPS 없음 → PWA·푸시·생체인증 전부 불가 | ❌ 목적 미달 |

> **다음 확인 사항**: 대표가 **이미 보유한 도메인이 있는지**. 있으면 Cloudflare Tunnel이 완전 무료가 되어 문제가 해소된다.

---

### ~~✅ 결정: Tailscale (유료 플랜) — 2026-09-01 대표 확정~~ (보류)

| 근거 | 설명 |
|------|------|
| **노출이 없다** | 결정적 근거. Cloudflare Tunnel은 기본이 공개 인터넷 노출이라 **RISK-011이 그대로 살아난다.** Tailscale은 내 기기끼리만 통해 공격면이 사실상 늘지 않는다 |
| 도메인 불필요 | `*.ts.net`이 고정 주소가 된다. WebAuthn 전제 충족 |
| 설정이 짧다 | 앱 설치 + `tailscale serve` 1줄 |
| **서버 설정 무변경** | 아래 §핵심 이점 참조 |

**감수하는 것 2가지**
1. **유료** — 상업 사용이므로 무료 Personal 플랜 사용 불가
2. **폰에 Tailscale 앱 설치·로그인 필요**

**기각**: Cloudflare Tunnel — 비용은 싸지만 기본이 공개 노출이라 보안 경계 재설계 부담이 크다. Headscale — 오픈소스·무료이나 **컨트롤 서버를 또 어디에 둘 것인가**라는 순환 문제가 생기고 1인 운영에 과하다.

### 핵심 이점 — 서버 코드·설정을 바꾸지 않아도 된다

`tailscale serve`는 **Tailscale 쪽에서 HTTPS를 종료하고 `127.0.0.1:3000`으로 프록시**한다.

```
폰 (Tailscale 앱)
  ↓ https://<기기명>.<테일넷>.ts.net
Tailscale (HTTPS 종료)
  ↓ http://127.0.0.1:3000
ClaudeManager 서버   ← 그대로. CM_HOST 변경 불필요
```

이 덕분에:

| 영향 | 결과 |
|------|------|
| `CM_HOST=127.0.0.1` | **유지** — DES-009 상수 변경 불필요 |
| DES-001 "localhost only 바인딩" 전제 | **유지** — 서버는 여전히 루프백만 듣는다 |
| RISK-010 / RISK-011 | **등급 하향 가능** — 서버가 인터넷에 직접 노출되지 않는다 |

> 앞서 "DES-001·DES-009 개정 규모 대"로 잡았으나, Tailscale 선택으로 **개정 범위가 크게 줄었다.** 아키텍처에 Tunnel 요소를 그리고 접속 경로를 문서화하는 수준이면 된다.

### 대표 준비 체크리스트

| # | 할 일 | 비고 |
|:---:|------|------|
| 1 | **Tailscale 계정 생성 + 유료 플랜 전환** | 사업 용도이므로 Personal(무료) 사용 불가. 커스텀 도메인 이메일로 가입하면 사업용으로 자동 판정, 14일 체험 제공 |
| 2 | **PC(서버 실행 기기)에 Tailscale 설치 + 로그인** | macOS/Windows 클라이언트 |
| 3 | **폰에 Tailscale 앱 설치 + 같은 계정 로그인** | iOS / Android |
| 4 | **관리 콘솔에서 MagicDNS 켜기** | 기기 이름으로 접속하기 위함 |
| 5 | **관리 콘솔에서 HTTPS Certificates 켜기** | ⚠️ **기기명과 테일넷 이름이 공개 원장(Certificate Transparency)에 게시**되는 데 동의해야 한다. 내용은 노출되지 않지만 이름은 공개된다 |
| 6 | 확정된 주소를 알려주기 | `https://<기기명>.<테일넷>.ts.net` — 페어링 URL과 WebAuthn 도메인으로 고정 사용 |

### 대표 준비 완료 후 개발 측 작업

```bash
# 서버 실행 기기에서 1회 설정
tailscale cert <기기명>.<테일넷>.ts.net     # 인증서 발급
tailscale serve --bg 3000                   # 3000포트를 HTTPS로 노출 (tailnet 내부 전용)
tailscale serve status                      # 확인
```

> `tailscale funnel`은 **쓰지 않는다.** Funnel은 공개 인터넷 노출이라 이번 선택의 취지와 반대다. **`serve`만 사용**한다.

### 후속 영향

| 문서 | 변경 |
|------|------|
| DES-001 아키텍처 | Container Diagram에 Tunnel 요소 추가, 보안 경계 재정의 |
| DES-009 코드 정의서 | `DEFAULT_HOST` 주석 갱신 (localhost only → 터널 바인딩) |
| ANL-003 RISK-010/011 | Tailscale 선택 시 **등급 하향 가능** (공개 노출 없음) |
| DES-015 §6-6 | 페어링 URL을 `https://<기기명>.<테일넷>.ts.net/p/<토큰>` 형태로 확정 |

### 참고

- [Tailscale MagicDNS](https://tailscale.com/docs/features/magicdns) · [HTTPS 인증서 설정](https://tailscale.com/docs/how-to/set-up-https-certificates) · [Serve vs Funnel](https://deepwiki.com/tailscale-dev/ScaleTail/1.2-tailscale-concepts:-serve-funnel-and-magicdns)
- [Cloudflare Quick Tunnels 제약](https://cloudflare-docs.justalittlebyte.ovh/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) · [Cloudflare Tunnel 설정 12단계](https://tech-insider.org/ie/cloudflare-tunnel-setup-2026/)

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1 | 2026-08-23 | 최초 작성 — ADR-001~004, 평가 매트릭스 |
| — | 2026-09-01 | **Git 동기화** + 승인 반영 스택 추가(ADR-006~011 예정) 정리 |
