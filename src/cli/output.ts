import type { Pagination } from '../shared/types.js';

/**
 * CLI 출력 포맷 헬퍼 — 목록 3종(project·agent·task)·status-changes가
 * 공유하는 표·박스·페이지 푸터 규칙
 *
 * 정의 원본: DES-006 v3.2 §3(표시 데이터) · §8(공통 동작 규칙 — 출력 형식·
 * ID 축약 규칙·출력 컬럼 규칙)
 *
 * Layer 3-2 그룹 A가 이 파일로 "같은 규칙"을 굳힌다(개발 지시 §2) — project·
 * agent·task 목록이 서로 다른 표 렌더링을 만들지 않도록, 표·박스 조립은
 * 전부 이 헬퍼를 거친다. auth.ts는 목록·표를 다루지 않아 선례가 없으므로
 * 이 파일이 그 몫의 최초 관용구가 된다.
 */

/** §8 ID 축약 규칙 — 목록은 8자, 상세/생성 결과는 전체 UUID */
export const ID_SHORT_LEN = 8;

/** §8 출력 컬럼 규칙 — Name/Title 최대 20자, 초과 시 '...' */
export const NAME_MAX_LEN = 20;

export function shortId(id: string): string {
  return id.slice(0, ID_SHORT_LEN);
}

/** 초과 시 말줄임(`...`)으로 자른다 — 잘림 자체가 20자를 넘지 않는다 */
export function truncateName(value: string, maxLen: number = NAME_MAX_LEN): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 3))}...`;
}

/**
 * ISO 8601 → 로컬 `YYYY-MM-DD HH:mm:ss` (§8 출력 컬럼 규칙 — Created 19자 고정,
 * §4 공통 규칙 — "시각은 YYYY-MM-DD HH:mm:ss(로컬)").
 */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * 간단한 고정폭 표. 컬럼 폭은 헤더·본문·`minWidths` 중 가장 넓은 값으로
 * 자동 계산한다 — ID는 호출부가 이미 8자로 잘라 넘기고, Status처럼 "10자,
 * 잘림 없음" 규칙인 컬럼은 `minWidths`로 최소폭만 지정해 긴 값(예:
 * `pending_completion`)이 안 잘리게 한다.
 */
export function renderTable(headers: string[], rows: string[][], minWidths: number[] = []): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, minWidths[i] ?? 0, ...rows.map((r) => (r[i] ?? '').length)),
  );
  const renderRow = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] as number))
      .join('  ')
      .trimEnd();
  const separator = widths.map((w) => '-'.repeat(w)).join('  ');
  return [renderRow(headers), separator, ...rows.map(renderRow)].join('\n');
}

/** 상세 박스 — "필드명: 값" 들여쓰기 2칸 (§8 출력 형식) */
export function formatFields(fields: Array<[string, string]>): string {
  return fields.map(([key, value]) => `  ${key}: ${value}`).join('\n');
}

/** 페이지 n/m · 총 건수 (+ 적용 필터가 있으면 이어서) */
export function paginationFooter(pagination: Pagination, filters: string[] = []): string {
  const lines = [`페이지 ${pagination.page}/${pagination.totalPages} · 총 ${pagination.total}건`];
  for (const f of filters) lines.push(`filtered by: ${f}`);
  return lines.join('\n');
}

/**
 * 총 건수만 (+ 적용 필터) — Layer 3-2 그룹 B 추가.
 *
 * `GET /api/conversations`·`/search`는 `pagination` 객체를 돌려주지 않는다
 * (ConversationService.list·search의 반환 타입이 배열이다 — DES-004 §전체
 * 함수 시그니처 요약). `paginationFooter`는 `Pagination`(page·totalPages
 * 포함)을 요구해 여기 못 쓴다. 목록 3종(project·agent·task)의 페이지 푸터는
 * 그대로 두고, 페이지네이션이 없는 목록 전용으로 별도 함수를 추가한다.
 */
export function totalFooter(total: number, filters: string[] = []): string {
  const lines = [`총 ${total}건`];
  for (const f of filters) lines.push(`filtered by: ${f}`);
  return lines.join('\n');
}

/**
 * ANSI dim — SCR-CH11 "archived는 dim"(DES-006 §3-1·EVT-CH11-1). 색상을
 * 지원하지 않는 파이프·리다이렉션 환경에서도 코드는 무해하게 그대로
 * 지나간다(대부분의 터미널·페이저가 SGR을 무시하거나 다음 리셋까지만
 * 적용한다). ID·상태 값 자체는 바꾸지 않는다 — 잘라내거나 치환하지 않고
 * 감싸기만 한다.
 */
export function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

/**
 * FTS5 `snippet()`이 내려주는 `<mark>…</mark>`를 터미널 강조(굵게)로 바꾼다
 * (SCR-CH13 "snippet → 터미널 강조"). HTML을 렌더링하는 게 아니라 이
 * 두 태그만 치환한다 — 검색어 외 임의 HTML이 본문에 섞여 들어올 경로가
 * 없다(FTS5가 매칭 구간에만 태그를 삽입한다).
 */
export function highlightMark(text: string): string {
  return text.replaceAll('<mark>', '\x1b[1m').replaceAll('</mark>', '\x1b[0m');
}

/** §8 출력 형식 — 성공 요약 */
export function successBlock(headline: string, body?: string): string {
  return body ? `✓ ${headline}\n\n${body}` : `✓ ${headline}`;
}

/** §8 출력 형식 — 실패 요약 (`hint`는 해결 명령 등 후속 안내) */
export function errorBlock(message: string, hint?: string): string {
  return hint ? `✗ ${message}\n  ${hint}` : `✗ ${message}`;
}
