import { createInterface } from 'node:readline';
import { MAX_PAGE_SIZE } from '../shared/constants.js';
import type { Pagination } from '../shared/types.js';
import { ApiClient } from './api-client.js';
import { loadAuth } from './config.js';
import { errorBlock, shortId } from './output.js';

/**
 * `project`·`agent`·`task`·`status-changes` 4개 명령 파일이 공유하는 실행
 * 골격 — 인증 가드·의존성 기본값·ID 접두어 해석·공통 에러 표시.
 *
 * `commands/auth.ts`(Layer 3-1)는 `/auth/login`·`/health`가 인증 불필요
 * 라우트라 이 골격이 필요 없었다. SCR-P01~SC01은 전부 `onRequest:
 * [app.authenticate]`가 걸린 보호 라우트이므로(DES-006 §2 "인증: 필요"),
 * 14개 명령이 매번 같은 3줄(토큰 없음·만료·서버 unreachable, §8 공통 에러)을
 * 반복하지 않게 여기 한 번만 둔다 — 개발 지시 §2 "공통 로직이 반복되면
 * 헬퍼로 뽑되, auth.ts가 이미 하는 것과 다른 방식을 만들지 마라"를
 * 따른다: auth.ts의 `AuthCommandDeps`(createClient·log·errorLog·setExitCode
 * 조합)와 같은 모양을 쓴다.
 */

/** `ApiClient`의 최소 인터페이스 — 테스트가 undici 없이 페이크를 주입할 수 있다 (auth.ts `AuthApiClient`와 동형) */
export interface CliApiClient {
  baseUrl: string;
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export interface CommandDeps {
  createClient: () => CliApiClient;
  homeDir?: string;
  now?: () => Date;
  log: (msg: string) => void;
  errorLog: (msg: string) => void;
  setExitCode: (code: number) => void;
}

export function defaultCommandDeps(): CommandDeps {
  return {
    createClient: () => new ApiClient({ token: loadAuth()?.token ?? null }),
    log: (msg) => console.log(msg),
    errorLog: (msg) => console.error(msg),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

// ─────────────────────────────────────────────
// 인증 가드 — §8 공통 에러 "토큰 없음"·"토큰 만료"
// ─────────────────────────────────────────────

export type AuthGuardResult =
  | { ok: true }
  | { ok: false; reason: 'not_authenticated' }
  | { ok: false; reason: 'expired' };

/**
 * 보호된 명령의 액션 첫 줄에서 호출한다. 로컬 토큰만 본다 — 서버 왕복 없이
 * "토큰 없음"·"만료"를 즉시 알려준다(`cm auth status`의 `runStatus`와 같은
 * 판단). 서버가 그래도 401을 돌려주면 `presentApiError`가 같은 문구로
 * 다시 잡는다(시계 오차 등으로 로컬 판단과 서버 판단이 갈리는 경우의 방어선).
 */
export function checkAuth(homeDir?: string, now: () => Date = () => new Date()): AuthGuardResult {
  const auth = loadAuth(homeDir);
  if (!auth) return { ok: false, reason: 'not_authenticated' };
  if (new Date(auth.expiresAt).getTime() <= now().getTime()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
}

export function presentAuthGuardFailure(result: AuthGuardResult, deps: CommandDeps): void {
  if (result.ok) return;
  if (result.reason === 'not_authenticated') {
    deps.errorLog(errorBlock('인증이 필요합니다', 'cm auth login'));
  } else {
    deps.errorLog(errorBlock('토큰이 만료되었습니다', 'cm auth login'));
  }
  deps.setExitCode(1);
}

/**
 * 도메인 run* 함수들이 `ServerUnreachableError`·`UNAUTHORIZED`/
 * `AUTH_TOKEN_EXPIRED`를 잡을 때 쓰는 공용 문구(§8 공통 에러). `runLogin`
 * (auth.ts)처럼 판정 로직은 각 run*가 직접 `instanceof` 분기하고, 문구만
 * 여기서 공유한다 — 14개 명령이 같은 표현을 쓰게 하기 위함이다.
 */
export function serverUnreachableBlock(serverUrl: string): string {
  return errorBlock(`서버에 연결할 수 없습니다 (${serverUrl})`, 'npm run server:start');
}

export function unauthenticatedBlock(expired: boolean): string {
  return errorBlock(expired ? '토큰이 만료되었습니다' : '인증이 필요합니다', 'cm auth login');
}

// ─────────────────────────────────────────────
// ID 접두어 해석 — §8 "ID 축약 규칙"
// ─────────────────────────────────────────────

/** `crypto.randomUUID()` 형식(8-4-4-4-12)의 전체 길이 */
const FULL_ID_LEN = 36;

export type ResolveIdResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> };

/**
 * 목록 API를 훑어 8자 접두어를 전체 UUID로 확장한다.
 *
 * 백엔드 `findById`는 정확히 일치하는 UUID만 찾는다(`WHERE id = ?`) —
 * 8자 접두어를 그대로 상세 API에 넘기면 항상 `NOT_FOUND`다. DES-006 §8이
 * 요구하는 "명령어 인자: 앞 8자리 허용(고유할 때)"·"축약 충돌 → 후보 목록"은
 * 백엔드에 없는 기능이라 CLI가 목록 조회로 직접 구현한다(백엔드는 완결
 * 범위 — 손대지 않는다).
 *
 * 입력이 전체 UUID 길이(36자)면 조회를 건너뛰고 그대로 통과시킨다 — 호출부의
 * 상세 API 호출이 `NOT_FOUND`를 자연스럽게 낸다.
 */
export async function resolveId<T extends { id: string }>(
  client: CliApiClient,
  listPath: string,
  idOrPrefix: string,
  labelOf: (item: T) => string,
): Promise<ResolveIdResult> {
  if (idOrPrefix.length === FULL_ID_LEN) {
    return { ok: true, id: idOrPrefix };
  }

  const candidates: Array<{ id: string; label: string }> = [];
  let page = 1;
  for (;;) {
    const sep = listPath.includes('?') ? '&' : '?';
    const res = await client.get<{ data: T[]; pagination: Pagination }>(
      `${listPath}${sep}page=${page}&pageSize=${MAX_PAGE_SIZE}`,
    );
    for (const item of res.data) {
      if (item.id.startsWith(idOrPrefix)) {
        candidates.push({ id: item.id, label: labelOf(item) });
      }
    }
    if (page >= res.pagination.totalPages) break;
    page += 1;
  }

  if (candidates.length === 0) return { ok: false, reason: 'not_found' };
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous', candidates };
  return { ok: true, id: (candidates[0] as { id: string }).id };
}

/** §8 "축약 충돌" 공통 출력 — 후보 목록 + "더 긴 ID를 입력하세요" */
export function ambiguousIdBlock(candidates: Array<{ id: string; label: string }>): string {
  const lines = candidates.map((c) => `  ${c.id}  ${c.label}`);
  return `${errorBlock('ID가 여러 건과 일치합니다', '더 긴 ID를 입력하세요')}\n${lines.join('\n')}`;
}

/** 상세/상태변경/삭제 3종 명령이 공유하는 실패 모양 — `resolveId`가 실패했을 때의 변환 */
export type IdLookupFailure =
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> };

/** `resolved.ok === false`일 때만 호출한다 */
export function toIdLookupFailure(
  resolved: Exclude<ResolveIdResult, { ok: true }>,
  inputId: string,
): IdLookupFailure {
  if (resolved.reason === 'not_found') return { ok: false, reason: 'not_found', id: inputId };
  return { ok: false, reason: 'ambiguous', candidates: resolved.candidates };
}

/** 완성형 한글 음절(U+AC00~U+D7A3) 범위 — `chooseParticle`의 받침 판정 기준 */
const HANGUL_SYLLABLE_BASE = 0xac00;
const HANGUL_SYLLABLE_LAST = 0xd7a3;

/**
 * 한글 받침 유무로 "을"/"를"을 고른다 — 완성형 한글 음절의 코드 포인트를
 * 28로 나눈 나머지가 0이면 종성이 없다(받침 없음).
 * 라벨이 한글 음절로 끝나지 않으면(영문 등) 기존 동작을 유지한다 — "Agent"·
 * "Project"는 발음("에이전트"·"프로젝트")이 받침 없는 "트"로 끝나 "를"이
 * 맞았고, 그 라벨들의 출력은 이 함수 도입 전과 동일하게 유지된다.
 */
function chooseParticle(label: string, withBatchim: string, withoutBatchim: string): string {
  const last = label.trimEnd().slice(-1);
  const code = last.codePointAt(0) ?? 0;
  if (code >= HANGUL_SYLLABLE_BASE && code <= HANGUL_SYLLABLE_LAST) {
    const hasBatchim = (code - HANGUL_SYLLABLE_BASE) % 28 !== 0;
    return hasBatchim ? withBatchim : withoutBatchim;
  }
  return withoutBatchim;
}

/**
 * §8 "토큰 없음"·"만료" 이외의 존재 실패 — 엔티티별 라벨만 바꿔 쓴다.
 *
 * `를`을 하드코딩했던 이전 버전은 "승인 건를"·"대화 채널를"처럼 받침 있는
 * 라벨에서 조사가 틀렸다(Layer 3-2 그룹 D 개발 지시 §4 — 그룹 B·C에 걸친
 * 사전 결함). `chooseParticle`로 받침 유무를 판정해 "을"/"를"을 고른다.
 */
export function notFoundBlock(label: string, id: string, hint: string): string {
  const particle = chooseParticle(label, '을', '를');
  return errorBlock(`${label}${particle} 찾을 수 없습니다: ${id}`, hint);
}

// ─────────────────────────────────────────────
// 캐스케이드 diff — SCR-P04·AG04 "(취소 시) 캐스케이드 대상 전체 목록"
// ─────────────────────────────────────────────

/**
 * `PATCH /api/projects/:id/status`·`PATCH /api/agents/:id/status` 응답은
 * 캐스케이드로 바뀐 하위 엔티티를 돌려주지 않는다(DES-002 v2.4 §3-1·
 * DES-004 §6·§8 — 캐스케이드는 Service 내부 부수효과로만 기록되고 API
 * 응답 스키마엔 없다). 백엔드는 완결 범위라 응답을 넓히지 않고, CLI가
 * 전이 전후 스냅샷을 직접 비교해 캐스케이드 대상을 도출한다.
 */
export interface CascadeItem {
  id: string;
  label: string;
  from: string;
  to: string;
}

export function diffCascade<T extends { id: string; status: string }>(
  before: T[],
  after: T[],
  labelOf: (item: T) => string,
): CascadeItem[] {
  const afterMap = new Map(after.map((item) => [item.id, item]));
  const result: CascadeItem[] = [];
  for (const b of before) {
    const a = afterMap.get(b.id);
    if (a && a.status !== b.status) {
      result.push({ id: b.id, label: labelOf(b), from: b.status, to: a.status });
    }
  }
  return result;
}

/** ⚠ 경고블록 — 캐스케이드 대상 각각의 이름과 전이 (DES-006 §4-2 EVT-P04-3·§4-3 EVT-AG04-3) */
export function cascadeBlock(title: string, items: CascadeItem[]): string {
  const lines = items.map((i) => `  ${i.label} (${shortId(i.id)}): ${i.from} → ${i.to}`);
  return `⚠ ${title}\n${lines.join('\n')}`;
}

// ─────────────────────────────────────────────
// y/N 확인 프롬프트 — PRM-02·PRM-03 (`cm agent delete`)
// ─────────────────────────────────────────────

/**
 * `commands/auth.ts`의 `defaultPromptSecret`과 같은 원칙이다: 비대화형
 * 환경(파이프·CI)에서는 프롬프트가 의미가 없으니 `NOT_TTY`로 즉시 거부한다
 * (§5 프롬프트 공통 규칙 4 — "비대화형 환경에서 프롬프트가 필요하면 실행을
 * 중단하고 `--force` 사용을 안내한다"). 마스킹이 필요 없어 `_writeToOutput`
 * 재정의 없이 표준 `readline.question`을 그대로 쓴다.
 */
export function defaultPromptConfirm(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.reject(new Error('NOT_TTY'));
  }

  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('CANCELLED'));
    });
  });
}
