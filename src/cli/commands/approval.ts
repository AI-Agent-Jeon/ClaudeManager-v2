import type { Command } from 'commander';
import {
  ApprovalStatus,
  ApprovalType,
  DecisionLevel,
  ErrorCode,
  SyncStatus,
} from '../../shared/constants.js';
import type { ApprovalDetail, ApprovalSummary, PhaseCurrent } from '../../shared/types.js';
import { ApiRequestError } from '../api-client.js';
import {
  formatFields,
  formatTimestamp,
  ID_SHORT_LEN,
  NAME_MAX_LEN,
  renderTable,
  shortId,
  successBlock,
  totalFooter,
  truncateName,
} from '../output.js';
import {
  ambiguousIdBlock,
  type CliApiClient,
  type CommandDeps,
  checkAuth,
  defaultCommandDeps,
  mapCommonApiError,
  notFoundBlock,
  presentAuthGuardFailure,
  serverUnreachableBlock,
  unauthenticatedBlock,
} from '../runtime.js';

/**
 * `cm inbox`·`cm decide`·`cm approvals`·`cm review` — SCR-CH04·05·07·08
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-CH04·05·07·08 · §3-1 표시 데이터 ·
 * §4-4 EVT-CH04·05·07·08 · DES-002 v2.4 §5(승인 엔드포인트 4종)·§7(에러 코드) ·
 * DES-014 §5(SCR-W-AP)·§6(CLI 대응)
 *
 * `commands/project.ts`·`agent.ts`(그룹 A)·`chat.ts`(그룹 B)와 같은 관용구를
 * 쓴다: 판정 로직(run*)은 콘솔에 쓰지 않고 판별 유니온만 돌려주고, `present*`가
 * §8 출력 형식으로 바꾼다. 4개 명령은 DES-006 화면 인벤토리에서 **최상위
 * 명령**(`cm inbox`, `cm decide`, `cm approvals`, `cm review`)이다 — `chat`·
 * `project`처럼 하위 명령을 묶는 부모가 아니다(index.ts 주석 확인).
 *
 * DES-014 §5 CLI 출력 예시(§356)는 ASCII 박스(`┌ 승인 요청 ─┐`)를 쓰지만,
 * 이 코드베이스가 이미 확립한 관용구(`output.ts`의 `formatFields` —
 * "  필드명: 값" 들여쓰기)를 그대로 따른다(개발 지시 §0-3 "새로 만들지
 * 마라"). 필드 구성은 DES-006 v3.2 §3-1(더 최신·상세)을 원본으로 삼는다 —
 * DES-014 예시의 "산출물" 3줄(경로만)보다 DES-006의 "코드·제목·Git 경로·
 * Notion URL·동기화 상태" 5필드가 우선한다(개발 지시 §2(1) "artifacts는
 * Layer 2-9에서 실제 값으로 채워진다").
 *
 * ── 승인 ID 해석 ──────────────────────────────────────────────
 * `GET /api/approvals`는 `project`·`agent`·`task`와 달리 `pagination` 객체가
 * 없다(배열만 반환 — DES-002 §5). `runtime.ts`의 `resolveId`는 `pagination.
 * totalPages`를 요구해 여기 못 쓴다 — `chat.ts`의 `resolveConversationId`와
 * 같은 이유로 이 파일에 전용 해석 함수(`resolveApprovalId`)를 둔다.
 *
 * ── `cm decide` 지원 범위 (등급 낮음, 자율 판단) ──────────────────
 * 개발 지시 §1 명령 표는 `cm decide <id> --approve|--reject`만 규정한다.
 * DES-006 EVT-CH05-5(플래그 없이 호출 시 PRM-CH01 프롬프트)는 §5 프롬프트
 * 명세 표(PRM-01~03)에 행이 없어 입력 형식·기본값·응답별 결과가 정의되지
 * 않았다 — 명세 공백이다. 여기서는 플래그 없이 호출하면 검증 실패로
 * 안내하고 두 플래그 사용법을 보여준다(§4 "설계서 충돌·명세 공백은 멈추고
 * 보고하라"에 따라 미해결 사항으로 별도 보고한다). `conditional`도 명령
 * 표에 없어 지원하지 않는다.
 */

/** `crypto.randomUUID()` 형식의 전체 길이 — `chat.ts`의 `FULL_ID_LEN`과 같은 값 */
const FULL_ID_LEN = 36;

const LEVEL_LABEL: Record<string, string> = {
  [DecisionLevel.HIGH]: '높음',
  [DecisionLevel.MEDIUM]: '보통',
  [DecisionLevel.LOW]: '낮음',
};

function levelLabel(level: string): string {
  return LEVEL_LABEL[level] ?? level;
}

const DECISION_LABEL: Record<string, string> = {
  [ApprovalStatus.APPROVED]: '승인',
  [ApprovalStatus.REJECTED]: '반려',
  [ApprovalStatus.CONDITIONAL]: '조건부 승인',
  [ApprovalStatus.AUTO_ADVANCED]: '자동 진행',
  [ApprovalStatus.PENDING]: '대기',
};

function decisionLabel(status: string): string {
  return DECISION_LABEL[status] ?? status;
}

// ─────────────────────────────────────────────
// 경과·잔여 시간 표시 — 서버가 계산한 elapsedSeconds·remainingSeconds를
// 사람이 읽는 형태로 바꾼다 (DES-006 §3-1 공통 규칙 "예: 1시간 12분 경과").
// CLI에서 다시 계산하지 않는다 — high는 서버가 이미 deadlineAt=null로
// 고정해 내려준다(개발 지시 §2(4)).
// ─────────────────────────────────────────────

function formatDurationKorean(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  if (minutes > 0) return `${minutes}분`;
  return `${s}초`;
}

function formatElapsed(seconds: number): string {
  return `${formatDurationKorean(seconds)} 경과`;
}

/** `remainingSeconds`가 `null`이면 무기한(high 등급, DES-002 §5) */
function formatRemaining(seconds: number | null): string {
  if (seconds === null) return '무기한';
  if (seconds <= 0) return '기한 초과';
  return `${formatDurationKorean(seconds)} 남음`;
}

// ─────────────────────────────────────────────
// 승인 ID 해석 — `cm decide`·`cm review` (§8 ID 축약 규칙)
// ─────────────────────────────────────────────

export type ApprovalLookupResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> };

/** `chat.ts`의 `resolveConversationId`와 같은 패턴 — 페이지네이션 없는 목록을 직접 훑는다 */
export async function resolveApprovalId(
  client: CliApiClient,
  idOrPrefix: string,
): Promise<ApprovalLookupResult> {
  const res = await client.get<{ data: ApprovalSummary[] }>('/approvals');
  const candidates = res.data.filter(
    (a) => a.id === idOrPrefix || (idOrPrefix.length < FULL_ID_LEN && a.id.startsWith(idOrPrefix)),
  );

  if (candidates.length === 0) return { ok: false, reason: 'not_found' };
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: candidates.map((a) => ({ id: a.id, label: a.subject })),
    };
  }
  return { ok: true, id: (candidates[0] as ApprovalSummary).id };
}

/**
 * `stageId` → 스킬명. `GET /api/approvals/:id`·`/resolve` 응답엔 `stageId`
 * (UUID)만 있고 스킬명이 없다 — `cm review`의 "단계" 필드, `cm decide`의
 * "다음 단계명" 안내 둘 다 `GET /api/phases/current`로 한 번 더 찾는다
 * (`project.ts`의 `fetchProjectDetailQuietly`와 같은 조용한 실패 원칙 —
 * 부가 정보 조회 실패로 본 결과를 무효화하지 않는다).
 */
async function findStageSkill(client: CliApiClient, stageId: string): Promise<string | undefined> {
  try {
    const res = await client.get<{ data: PhaseCurrent }>('/phases/current');
    return res.data.stages.find((s) => s.id === stageId)?.skill;
  } catch {
    return undefined;
  }
}

/**
 * NEW-02 — `requested_by`는 자유 문자열이라 `'main'`처럼 Agent 행이 없는
 * 요청자가 있다(DEV-D-06). Agent로 실재하는지 조회해, 재개될 Agent가 애초에
 * 없는 경우에는 "Agent가 재개됩니다" 문구를 내보내지 않기 위한 판별이다.
 * 위 `findStageSkill`과 같은 "조용한 실패" 원칙 — 조회 실패(네트워크 등)를
 * "존재하지 않음"으로 취급해도 결과가 안전한 방향(문구 생략)으로만 어긋난다.
 */
async function requesterIsAgent(client: CliApiClient, requestedBy: string): Promise<boolean> {
  try {
    await client.get(`/agents/${requestedBy}`);
    return true;
  } catch {
    return false;
  }
}

async function fetchApprovalQuietly(
  client: CliApiClient,
  id: string,
): Promise<ApprovalDetail | null> {
  try {
    return (await client.get<{ data: ApprovalDetail }>(`/approvals/${id}`)).data;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// inbox — SCR-CH04
// ─────────────────────────────────────────────

export type ApprovalInboxResult =
  | { ok: true; items: ApprovalSummary[] }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runInbox(opts: { client: CliApiClient }): Promise<ApprovalInboxResult> {
  try {
    const res = await opts.client.get<{ data: ApprovalSummary[] }>('/approvals?status=pending');
    return { ok: true, items: res.data };
  } catch (err) {
    return mapListError(err, opts.client);
  }
}

/**
 * REV-L-07 — `runtime.ts`의 `mapCommonApiError`(REV-H-03 도입)와 완전히 같은
 * 모양이라 그 헬퍼에 위임한다. 이 파일 안에서 쓰는 이름은 유지한다(다른
 * 세 개 실패 유니온이 이 이름을 참조한다).
 */
function mapListError(
  err: unknown,
  client: CliApiClient,
):
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' } {
  return mapCommonApiError(err, client);
}

function presentListFailure(
  result:
    | { ok: false; reason: 'server_unreachable'; serverUrl: string }
    | { ok: false; reason: 'unauthenticated' },
  deps: CommandDeps,
): void {
  if (result.reason === 'server_unreachable')
    deps.errorLog(serverUnreachableBlock(result.serverUrl));
  else deps.errorLog(unauthenticatedBlock(false));
  deps.setExitCode(1);
}

function presentInbox(result: ApprovalInboxResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentListFailure(result, deps);
    return;
  }

  if (result.items.length === 0) {
    deps.log(successBlock('승인 대기함', '대기 중인 의사결정이 없습니다'));
    deps.setExitCode(0);
    return;
  }

  const rows = result.items.map((a) => [
    shortId(a.id),
    a.approvalType,
    levelLabel(a.level),
    truncateName(a.subject),
    a.requestedBy,
    formatElapsed(a.elapsedSeconds),
    formatRemaining(a.remainingSeconds),
  ]);
  const table = renderTable(['ID', '유형', '등급', '안건', '요청자', '경과', '잔여'], rows, [
    ID_SHORT_LEN,
    9,
    4,
    NAME_MAX_LEN,
    8,
    10,
    10,
  ]);

  // EVT-CH04-3 — 높음 등급은 무기한 대기다
  const hasHigh = result.items.some((a) => a.level === DecisionLevel.HIGH);
  const warning = hasHigh ? '\n\n⚠ 무기한 대기 — 대표 처리 전까지 Agent가 멈춰 있습니다' : '';

  deps.log(
    successBlock(
      '승인 대기함',
      `${table}\n\n${totalFooter(result.items.length)}${warning}\n\n  cm review <id>`,
    ),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// approvals — SCR-CH07
// ─────────────────────────────────────────────

export type ApprovalsListFilter = 'pending' | 'resolved';

export type ApprovalsListResult =
  | { ok: true; items: ApprovalSummary[]; filter?: ApprovalsListFilter }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runApprovalsList(opts: {
  client: CliApiClient;
  pending?: boolean;
  resolved?: boolean;
}): Promise<ApprovalsListResult> {
  try {
    const qs = opts.pending ? '?status=pending' : '';
    const res = await opts.client.get<{ data: ApprovalSummary[] }>(`/approvals${qs}`);
    // `status`엔 "resolved"라는 값이 없다(DES-002 §5 — pending/approved/rejected/
    // conditional/auto_advanced 5종뿐). `--resolved`는 서버 필터가 아니라
    // 클라이언트에서 pending이 아닌 건만 골라낸다.
    const items = opts.resolved
      ? res.data.filter((a) => a.status !== ApprovalStatus.PENDING)
      : res.data;
    const filter: ApprovalsListFilter | undefined = opts.pending
      ? 'pending'
      : opts.resolved
        ? 'resolved'
        : undefined;
    return { ok: true, items, filter };
  } catch (err) {
    return mapListError(err, opts.client);
  }
}

function presentApprovalsList(result: ApprovalsListResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentListFailure(result, deps);
    return;
  }

  if (result.items.length === 0) {
    deps.log(successBlock('승인함', '승인 건이 없습니다'));
    deps.setExitCode(0);
    return;
  }

  const rows = result.items.map((a) => [
    shortId(a.id),
    a.approvalType,
    levelLabel(a.level),
    truncateName(a.subject),
    decisionLabel(a.status),
    a.requestedBy,
    `${formatDurationKorean(a.elapsedSeconds)} / ${
      a.remainingSeconds === null ? '무기한' : formatDurationKorean(a.remainingSeconds)
    }`,
  ]);
  const table = renderTable(['ID', '유형', '등급', '안건', '상태', '요청자', '경과/잔여'], rows, [
    ID_SHORT_LEN,
    9,
    4,
    NAME_MAX_LEN,
    10,
    8,
    16,
  ]);

  const filters = result.filter ? [result.filter] : [];
  deps.log(successBlock('승인함', `${table}\n\n${totalFooter(result.items.length, filters)}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// review — SCR-CH08
// ─────────────────────────────────────────────

export type ApprovalReviewResult =
  | { ok: true; approval: ApprovalDetail; stageSkill?: string }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

/** `runReview`·`runDecide` 공통 — APPROVAL_NOT_FOUND·server_unreachable·unauthenticated 매핑 */
function mapApprovalLookupError(
  err: unknown,
  client: CliApiClient,
  idOrPrefix: string,
):
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' } {
  if (err instanceof ApiRequestError && err.code === ErrorCode.APPROVAL_NOT_FOUND) {
    return { ok: false, reason: 'not_found', id: idOrPrefix };
  }
  return mapCommonApiError(err, client);
}

export async function runReview(opts: {
  client: CliApiClient;
  idOrPrefix: string;
}): Promise<ApprovalReviewResult> {
  try {
    const resolved = await resolveApprovalId(opts.client, opts.idOrPrefix);
    if (!resolved.ok) {
      if (resolved.reason === 'not_found')
        return { ok: false, reason: 'not_found', id: opts.idOrPrefix };
      return resolved;
    }

    const res = await opts.client.get<{ data: ApprovalDetail }>(`/approvals/${resolved.id}`);
    const approval = res.data;
    const stageSkill = approval.stageId
      ? await findStageSkill(opts.client, approval.stageId)
      : undefined;
    return { ok: true, approval, stageSkill };
  } catch (err) {
    return mapApprovalLookupError(err, opts.client, opts.idOrPrefix);
  }
}

/** 산출물 블록 — 코드·제목·Git 경로·Notion URL·동기화 상태 (DES-006 §3-1 SCR-CH08) */
function renderArtifactsBlock(artifacts: ApprovalDetail['artifacts']): string {
  if (artifacts.length === 0) return '  없음';
  return artifacts
    .map(
      (ar) =>
        `  ${ar.code} ${ar.title}\n` +
        `    Git: ${ar.gitPath ?? '없음'}\n` +
        `    Notion: ${ar.notionUrl ?? '없음'}\n` +
        `    동기화: ${ar.syncStatus}`,
    )
    .join('\n');
}

/** 선택지 블록 — 코드·라벨·권고 표시 (recommended → "← 권고") */
function renderOptionsBlock(options: ApprovalDetail['options']): string {
  if (options.length === 0) return '  없음';
  return options
    .map((o) => `  (${o.code}) ${o.label}${o.recommended ? '  ← 권고' : ''}`)
    .join('\n');
}

/** 영향 범위 블록 — 되돌림 가능 여부·영향 문서 목록 */
function renderImpactBlock(impact: ApprovalDetail['impact']): string {
  if (!impact) return '  없음';
  const documents = impact.documents.length > 0 ? impact.documents.join(', ') : '없음';
  return `  되돌림: ${impact.reversible ? '가능' : '불가'}\n  영향 문서: ${documents}`;
}

function presentReview(result: ApprovalReviewResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentIdOrCommonFailure(result, deps, '승인 건', 'cm approvals');
    return;
  }

  const a = result.approval;
  const idShort = shortId(a.id);

  const header = formatFields([
    ['안건', a.subject],
    ['유형', a.approvalType],
    ['등급', levelLabel(a.level)],
    ['단계', result.stageSkill ?? '없음'],
    ['요청자', a.requestedBy],
    ['요청시각', `${formatTimestamp(a.createdAt)} (${formatElapsed(a.elapsedSeconds)})`],
  ]);

  // EVT-CH08-2 — notion_only는 동기화 누락이지 프로세스 위반이 아니다
  const notionOnlyCount = a.artifacts.filter(
    (ar) => ar.syncStatus === SyncStatus.NOTION_ONLY,
  ).length;
  const syncWarning =
    notionOnlyCount > 0
      ? `\n\n⚠ Git 동기화 누락 ${notionOnlyCount}건 — 프로세스 위반이 아닙니다 (Notion에는 존재합니다)`
      : '';

  const responseBlock =
    `  cm decide ${idShort} --approve\n` + `  cm decide ${idShort} --reject --reason "<사유>"`;

  const body = [
    header,
    `산출물 (${a.artifacts.length})\n${renderArtifactsBlock(a.artifacts)}`,
    `선택지\n${renderOptionsBlock(a.options)}`,
    `근거\n  ${a.rationale ?? '없음'}`,
    `영향 범위\n${renderImpactBlock(a.impact)}${syncWarning}`,
    `응답:\n${responseBlock}`,
  ].join('\n\n');

  deps.log(successBlock('승인 요청', body));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// decide — SCR-CH05
// ─────────────────────────────────────────────

export type ApprovalDecideResult =
  | { ok: true; approval: ApprovalDetail; nextStageSkill?: string; requesterIsAgent: boolean }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'reason_required' }
  | { ok: false; reason: 'validation'; message: string }
  | { ok: false; reason: 'already_resolved'; existing: ApprovalDetail | null }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runDecide(opts: {
  client: CliApiClient;
  idOrPrefix: string;
  decision: 'approve' | 'reject';
  resolution?: string;
  reason?: string;
}): Promise<ApprovalDecideResult> {
  // 안전장치 S-2 — 반려는 사유가 필수다. 서버가 어차피 APPROVAL_REASON_REQUIRED로
  // 막지만, 여기서 먼저 막아 왕복을 줄인다(개발 지시 §2(2)).
  if (opts.decision === 'reject' && !opts.reason) {
    return { ok: false, reason: 'reason_required' };
  }

  let resolvedId = opts.idOrPrefix;
  try {
    const resolved = await resolveApprovalId(opts.client, opts.idOrPrefix);
    if (!resolved.ok) {
      if (resolved.reason === 'not_found')
        return { ok: false, reason: 'not_found', id: opts.idOrPrefix };
      return resolved;
    }
    resolvedId = resolved.id;

    // `decision`은 'approve'|'reject' 둘뿐이다 — 'auto_advanced'를 보낼 방법이
    // 타입 수준에서 없다(개발 지시 §2(2) "CLI가 그 값을 보낼 수 있게 만들지 마라").
    // 'conditional'은 명령 표(§1)에 없어 지원하지 않는다(위 파일 헤더 참조).
    const status = opts.decision === 'approve' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    const res = await opts.client.post<{ data: ApprovalDetail }>(
      `/approvals/${resolvedId}/resolve`,
      {
        status,
        resolution: opts.resolution ?? null,
        reason: opts.reason ?? null,
      },
    );
    const approval = res.data;

    // SCR-CH05 후속 안내 — APV-GATE가 승인되면 다음 단계명을 알려준다
    // (승인은 게이트만 열 뿐 착수는 별도 명령이다, DES-002 §5 R-03).
    let nextStageSkill: string | undefined;
    if (
      approval.approvalType === ApprovalType.GATE &&
      approval.status === ApprovalStatus.APPROVED &&
      approval.stageId
    ) {
      nextStageSkill = await findStageSkill(opts.client, approval.stageId);
    }

    // NEW-02 — 반려는 Agent가 애초에 재개되지 않으므로(서비스 §rejected 분기,
    // 위 주석 참조) 조회가 필요 없다. 승인/조건부일 때만 요청자가 실재
    // Agent인지 확인해 "재개됩니다" 문구의 정확성을 보장한다.
    const requesterIsAgentFlag =
      approval.status === ApprovalStatus.REJECTED
        ? false
        : await requesterIsAgent(opts.client, approval.requestedBy);

    return { ok: true, approval, nextStageSkill, requesterIsAgent: requesterIsAgentFlag };
  } catch (err) {
    return mapDecideError(err, opts, resolvedId);
  }
}

async function mapDecideError(
  err: unknown,
  opts: { client: CliApiClient; idOrPrefix: string },
  resolvedId: string,
): Promise<ApprovalDecideResult> {
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.APPROVAL_NOT_FOUND) {
      return { ok: false, reason: 'not_found', id: opts.idOrPrefix };
    }
    if (err.code === ErrorCode.APPROVAL_ALREADY_RESOLVED) {
      // EVT-CH05-4 — 기존 결정·처리시각을 보여줘야 한다. 409 응답엔 없어
      // 조용히 한 번 더 조회한다(부가 정보 실패는 본 실패를 무효화하지 않는다).
      const existing = await fetchApprovalQuietly(opts.client, resolvedId);
      return { ok: false, reason: 'already_resolved', existing };
    }
    if (err.code === ErrorCode.APPROVAL_REASON_REQUIRED) {
      return { ok: false, reason: 'reason_required' };
    }
    if (err.code === ErrorCode.VALIDATION_ERROR) {
      return { ok: false, reason: 'validation', message: err.message };
    }
  }
  return mapCommonApiError(err, opts.client);
}

/** `already_resolved` 실패 1건의 안내문 — EVT-CH05-4 "기존 결정·처리시각" */
function alreadyResolvedMessage(existing: ApprovalDetail | null): string {
  if (!existing) return '✗ 이미 처리된 승인 건입니다';
  const resolvedAt = existing.resolvedAt ? formatTimestamp(existing.resolvedAt) : '-';
  return `✗ 이미 처리된 승인 건입니다\n  결정: ${decisionLabel(existing.status)} · 처리시각: ${resolvedAt}`;
}

function presentDecideFailure(
  result: Exclude<ApprovalDecideResult, { ok: true }>,
  deps: CommandDeps,
): void {
  switch (result.reason) {
    case 'not_found':
      deps.errorLog(notFoundBlock('승인 건', result.id, 'cm approvals'));
      break;
    case 'ambiguous':
      deps.errorLog(ambiguousIdBlock(result.candidates));
      break;
    case 'reason_required':
      deps.errorLog(
        '✗ 반려·조건부 승인은 사유가 필요합니다\n  cm decide <id> --reject --reason "<사유>"',
      );
      break;
    case 'validation':
      deps.errorLog(`✗ ${result.message}`);
      break;
    case 'already_resolved':
      deps.errorLog(alreadyResolvedMessage(result.existing));
      break;
    case 'server_unreachable':
      deps.errorLog(serverUnreachableBlock(result.serverUrl));
      break;
    case 'unauthenticated':
      deps.errorLog(unauthenticatedBlock(false));
      break;
  }
  deps.setExitCode(1);
}

function presentDecide(result: ApprovalDecideResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentDecideFailure(result, deps);
    return;
  }

  const a = result.approval;
  const chosen = a.resolution ? a.options.find((o) => o.code === a.resolution) : undefined;

  const fields = formatFields([
    ['승인 ID', shortId(a.id)],
    ['안건', a.subject],
    ['결정', decisionLabel(a.status)],
    ['채택 선택지', chosen ? `${chosen.code} ${chosen.label}` : (a.resolution ?? '없음')],
    ['사유', a.reason ?? '없음'],
    ['처리 시각', a.resolvedAt ? formatTimestamp(a.resolvedAt) : '-'],
  ]);

  // EVT-CH05-1·2 — 승인/조건부는 Agent가 재개되고, 반려는 대기 상태를 유지한다.
  // NEW-02 — `requestedBy`가 실재 Agent가 아니면(예: 'main') 재개될 Agent가
  // 애초에 없으므로, 그 경우는 문구 자체를 생략한다(§requesterIsAgent).
  const agentLine =
    a.status === ApprovalStatus.REJECTED
      ? 'Agent는 대기 상태를 유지합니다'
      : result.requesterIsAgent
        ? 'Agent가 재개됩니다 (waiting → running)'
        : null;

  const stageBlock = result.nextStageSkill
    ? `\n\n다음 단계: ${result.nextStageSkill}\n  cm stage start ${result.nextStageSkill}`
    : '';

  const body = agentLine ? `${fields}\n\n${agentLine}${stageBlock}` : `${fields}${stageBlock}`;

  deps.log(successBlock(`${decisionLabel(a.status)} 완료`, body));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// 공통 실패 표시 (not_found · ambiguous · server_unreachable · unauthenticated)
// ─────────────────────────────────────────────

function presentIdOrCommonFailure(
  result:
    | { ok: false; reason: 'not_found'; id: string }
    | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
    | { ok: false; reason: 'server_unreachable'; serverUrl: string }
    | { ok: false; reason: 'unauthenticated' },
  deps: CommandDeps,
  label: string,
  listHint: string,
): void {
  switch (result.reason) {
    case 'not_found':
      deps.errorLog(notFoundBlock(label, result.id, listHint));
      break;
    case 'ambiguous':
      deps.errorLog(ambiguousIdBlock(result.candidates));
      break;
    case 'server_unreachable':
      deps.errorLog(serverUnreachableBlock(result.serverUrl));
      break;
    case 'unauthenticated':
      deps.errorLog(unauthenticatedBlock(false));
      break;
  }
  deps.setExitCode(1);
}

// ─────────────────────────────────────────────
// Commander 연결 — 4개 명령은 전부 최상위 명령이다(index.ts 주석 참조)
// ─────────────────────────────────────────────

export function registerApprovalCommand(
  program: Command,
  overrides: Partial<CommandDeps> = {},
): void {
  const deps: CommandDeps = { ...defaultCommandDeps(), ...overrides };

  program
    .command('inbox')
    .description('미응답 의사결정 목록을 조회한다 (SCR-CH04)')
    .action(async () => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runInbox({ client: deps.createClient() });
      presentInbox(result, deps);
    });

  program
    .command('decide')
    .description('의사결정에 응답한다 (SCR-CH05)')
    .argument('<id>', '승인 ID (전체 또는 앞 8자리)')
    .option('--approve', '승인')
    .option('--reject', '반려')
    .option('--resolution <code>', '채택할 선택지 코드')
    .option('--reason <reason>', '사유 (반려는 필수)')
    .action(
      async (
        id: string,
        opts: { approve?: boolean; reject?: boolean; resolution?: string; reason?: string },
      ) => {
        const guard = checkAuth(deps.homeDir, deps.now);
        if (!guard.ok) return presentAuthGuardFailure(guard, deps);

        if (opts.approve && opts.reject) {
          deps.errorLog('✗ --approve와 --reject를 동시에 지정할 수 없습니다');
          deps.setExitCode(1);
          return;
        }
        if (!opts.approve && !opts.reject) {
          // EVT-CH05-5(PRM-CH01 프롬프트)는 명세 공백이라 지원하지 않는다
          // (위 파일 헤더 주석 참조) — 대신 두 플래그 사용법을 안내한다.
          deps.errorLog(
            '✗ --approve 또는 --reject를 지정하세요\n' +
              '  cm decide <id> --approve\n' +
              '  cm decide <id> --reject --reason "<사유>"',
          );
          deps.setExitCode(1);
          return;
        }

        const result = await runDecide({
          client: deps.createClient(),
          idOrPrefix: id,
          decision: opts.approve ? 'approve' : 'reject',
          resolution: opts.resolution,
          reason: opts.reason,
        });
        presentDecide(result, deps);
      },
    );

  program
    .command('approvals')
    .description('승인함 목록을 조회한다 (SCR-CH07)')
    .option('--pending', '대기 중인 건만')
    .option('--resolved', '처리된 건만')
    .action(async (opts: { pending?: boolean; resolved?: boolean }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runApprovalsList({
        client: deps.createClient(),
        pending: opts.pending,
        resolved: opts.resolved,
      });
      presentApprovalsList(result, deps);
    });

  program
    .command('review')
    .description('승인 건 상세를 조회한다 (SCR-CH08)')
    .argument('<id>', '승인 ID (전체 또는 앞 8자리)')
    .action(async (id: string) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runReview({ client: deps.createClient(), idOrPrefix: id });
      presentReview(result, deps);
    });
}
