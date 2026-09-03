import type { Command } from 'commander';
import { ErrorCode, SkillName, StageStatus, SyncStatus, WIP_RULE } from '../../shared/constants.js';
import type { Artifact, PhaseCurrent, StageSummary, WipViolation } from '../../shared/types.js';
import { ApiRequestError, ServerUnreachableError } from '../api-client.js';
import {
  formatFields,
  formatTimestamp,
  NAME_MAX_LEN,
  renderTable,
  shortId,
  successBlock,
  totalFooter,
  truncateName,
} from '../output.js';
import {
  type CliApiClient,
  type CommandDeps,
  checkAuth,
  defaultCommandDeps,
  notFoundBlock,
  presentAuthGuardFailure,
  serverUnreachableBlock,
  unauthenticatedBlock,
} from '../runtime.js';

/**
 * `cm progress` · `cm stage start/complete <skill>` · `cm artifacts` —
 * SCR-CH06·09·14·10 (Layer 3-2 그룹 D — Phase 1 develop 마지막 그룹)
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-CH06·09·14·10 · §3-1 표시 데이터 ·
 * §4-5 "진행" EVT-CH06·09·14·10 · DES-002 v2.4 §5(GET /api/phases/current ·
 * POST /api/stages/:id/start·complete · GET /api/artifacts · POST
 * /api/wip-waivers) · DES-014 §6(CLI 대응)
 *
 * 그룹 A·B·C와 같은 관용구를 쓴다: 판정 로직(run*)은 콘솔에 쓰지 않고 판별
 * 유니온만 돌려주고, `present*`가 §8 출력 형식으로 바꾼다. DES-014 §6의
 * ASCII 그리드 예시(`▓ analyze` 등)는 쓰지 않는다 — `cm review`(그룹 C)가
 * DES-014의 ASCII 박스 대신 `output.ts` 관용구(`renderTable`·`formatFields`)를
 * 따른 것과 같은 이유다(개발 지시 §0-3 "새로 만들지 마라"). 7단계는
 * DES-006 §3-1이 규정한 필드(스킬명·상태·산출물 건수·승인대기 건수·게이트·
 * 시작~완료일)를 그대로 `renderTable` 행으로 만든다.
 *
 * ── DES-008 배치 계약 ──────────────────────────────────────────
 * `progress`(SCR-CH06) · `stage start`(SCR-CH09) · `stage complete`
 * (SCR-CH14) · `artifacts`(SCR-CH10) 4화면을 이 파일 하나에 등록한다.
 *
 * ── Phase 시작일·경과일수 (등급 낮음, 자율 판단) ───────────────────
 * `PhaseCurrent.phase`에는 `startedAt`이 없다(DES-002 §5 응답 예시·
 * `shared/types.ts` 확인 — id·number·name·currentStage 4필드뿐). 응답
 * 필드에 없는 것을 화면에 만들지 않는다는 원칙(§3-1 상단 주석)에 따라
 * Phase 자체의 시작일을 새로 만들지 않고, `plan` 단계(Phase당 항상 존재,
 * SDLC상 첫 단계)의 `startedAt`을 Phase 시작일의 대리값으로 쓴다 — `plan`이
 * 아직 착수 전이면(`startedAt=null`) 경과일수를 표시하지 않는다. 백엔드는
 * 완결 범위라 API를 넓히지 않는다(개발 지시 §1 "범위 밖").
 *
 * ── 3단 가드 실패 안내 — 이 그룹의 핵심 (개발 지시 §2) ───────────────
 * `POST /api/stages/:id/start`의 3종 에러(`GATE_NOT_PASSED`·
 * `INVALID_TRANSITION`·`WIP_VIOLATION`)는 `AppError`에 `details`를 싣지
 * 않는다(`stage.service.ts` 확인 — 메시지 문자열만 있다). 그래서 착수
 * 직전에 조회한 `GET /api/phases/current` 스냅숏(`resolveStageBySkill`이
 * 이미 갖고 있다)을 그대로 들고 있다가, 에러가 나면 그 스냅숏에서 "필요한
 * 승인 ID"(대상 단계의 `gate.approvalId`)·"직전 단계명·상태"(스킬 순서상
 * 바로 앞 단계)·"진행 중 단계명"(`status='in_progress'`인 다른 단계)을
 * 클라이언트에서 직접 계산한다 — 서버가 안 주는 정보를 추가 왕복 없이
 * 채운다.
 */

const SKILL_VALUES: readonly string[] = Object.values(SkillName);
const SYNC_STATUS_VALUES: readonly string[] = Object.values(SyncStatus);

const STAGE_STATUS_LABEL: Record<string, string> = {
  [StageStatus.PENDING]: '대기',
  [StageStatus.IN_PROGRESS]: '진행',
  [StageStatus.COMPLETED]: '완료',
};

function stageStatusLabel(status: string): string {
  return STAGE_STATUS_LABEL[status] ?? status;
}

// ─────────────────────────────────────────────
// 공통 — 현재 Phase 조회 (`no_phase` = 진행 중 Phase 없음, DES-002 §5)
// ─────────────────────────────────────────────

type PhaseFetchFailure =
  | { ok: false; reason: 'no_phase' }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

async function fetchPhaseCurrent(
  client: CliApiClient,
): Promise<{ ok: true; data: PhaseCurrent } | PhaseFetchFailure> {
  try {
    const res = await client.get<{ data: PhaseCurrent }>('/phases/current');
    return { ok: true, data: res.data };
  } catch (err) {
    return mapPhaseFetchError(err, client);
  }
}

function mapPhaseFetchError(err: unknown, client: CliApiClient): PhaseFetchFailure {
  if (err instanceof ServerUnreachableError) {
    return { ok: false, reason: 'server_unreachable', serverUrl: client.baseUrl };
  }
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.NOT_FOUND) return { ok: false, reason: 'no_phase' };
    if (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED) {
      return { ok: false, reason: 'unauthenticated' };
    }
  }
  throw err;
}

function presentPhaseFetchFailure(result: PhaseFetchFailure, deps: CommandDeps): void {
  if (result.reason === 'no_phase') {
    deps.errorLog('✗ 진행 중인 Phase가 없습니다');
  } else if (result.reason === 'server_unreachable') {
    deps.errorLog(serverUnreachableBlock(result.serverUrl));
  } else {
    deps.errorLog(unauthenticatedBlock(false));
  }
  deps.setExitCode(1);
}

// ─────────────────────────────────────────────
// progress — SCR-CH06
// ─────────────────────────────────────────────

export type ProgressResult = { ok: true; data: PhaseCurrent } | PhaseFetchFailure;

export async function runProgress(opts: { client: CliApiClient }): Promise<ProgressResult> {
  return fetchPhaseCurrent(opts.client);
}

function stageRow(s: StageSummary): string[] {
  const gate = s.gate.required ? (s.gate.passed ? '필요 · 통과' : '필요 · 미통과') : '-';
  const period = s.startedAt
    ? `${formatTimestamp(s.startedAt)} ~ ${s.completedAt ? formatTimestamp(s.completedAt) : ''}`
    : '-';
  return [
    s.skill,
    stageStatusLabel(s.status),
    String(s.artifactCount),
    String(s.pendingApprovalCount),
    gate,
    period,
  ];
}

/** EVT-CH06-3 — 게이트 필요 단계인데 아직 통과 못한 것마다 1행씩 */
function renderGateWarnings(stages: StageSummary[]): string[] {
  const warnings: string[] = [];
  for (const s of stages) {
    if (!s.gate.required || s.gate.passed) continue;
    const idx = SKILL_VALUES.indexOf(s.skill);
    const next = idx >= 0 ? SKILL_VALUES[idx + 1] : undefined;
    warnings.push(`⚠ ${s.skill} → ${next ?? '?'} 게이트가 통과된 기록이 없습니다`);
  }
  return warnings;
}

/** EVT-CH06-2 — 위반은 면제가 있어도 계속 보고한다(감춤 금지, 개발 지시 §3(1)) */
function renderWipViolationsBlock(violations: WipViolation[]): string {
  const blocks = violations.map((v) => {
    const waivedNote = v.waived ? ' (면제됨)' : '';
    const action = v.waived
      ? ''
      : '\n    조치: cm stage start <skill>  ·  cm progress --waive "<사유>"';
    return `  ${v.rule}${waivedNote}\n    ${v.detail}${action}`;
  });
  return `⚠ WIP 위반 (${violations.length})\n${blocks.join('\n\n')}`;
}

function presentProgress(result: ProgressResult, deps: CommandDeps, now: () => Date): void {
  if (!result.ok) {
    presentPhaseFetchFailure(result, deps);
    return;
  }

  const { phase, stages, wipViolations } = result.data;
  const planStage = stages.find((s) => s.skill === SkillName.PLAN);
  let elapsedText = '';
  if (planStage?.startedAt) {
    const days = Math.floor(
      (now().getTime() - new Date(planStage.startedAt).getTime()) / (24 * 60 * 60 * 1000),
    );
    elapsedText = ` · 시작 ${formatTimestamp(planStage.startedAt)} · ${days}일차`;
  }

  const header =
    `Phase ${phase.number}: ${phase.name}${elapsedText}\n` +
    `  현재 단계: ${phase.currentStage ?? '없음'}`;

  const headers = ['단계', '상태', '산출물', '승인대기', '게이트', '시작~완료'];
  const table = renderTable(headers, stages.map(stageRow));

  const gateWarnings = renderGateWarnings(stages);
  const gateBlock = gateWarnings.length > 0 ? `\n\n${gateWarnings.join('\n')}` : '';

  const wipBlock = wipViolations.length > 0 ? `\n\n${renderWipViolationsBlock(wipViolations)}` : '';

  deps.log(successBlock('진행 보드', `${header}\n\n${table}${gateBlock}${wipBlock}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// progress --waive — WIP 위반 면제 등록 (DES-014 §6 CLI 출력 예시,
// EVT-CH06-2·EVT-CH09-4 안내 문구가 가리키는 실제 동작)
// ─────────────────────────────────────────────

export type ProgressWaiveResult =
  | { ok: true; phaseName: string; reason: string }
  | { ok: false; reason: 'empty_reason' }
  | { ok: false; reason: 'no_phase' }
  | { ok: false; reason: 'validation'; message: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runProgressWaive(opts: {
  client: CliApiClient;
  reasonInput: string;
}): Promise<ProgressWaiveResult> {
  const reason = opts.reasonInput.trim();
  if (reason.length === 0) return { ok: false, reason: 'empty_reason' };

  const phaseFetch = await fetchPhaseCurrent(opts.client);
  if (!phaseFetch.ok) return phaseFetch;
  const { phase } = phaseFetch.data;

  try {
    await opts.client.post('/wip-waivers', { phaseId: phase.id, rule: WIP_RULE, reason });
    return { ok: true, phaseName: phase.name, reason };
  } catch (err) {
    return mapWaiveError(err, opts.client);
  }
}

function mapWaiveError(
  err: unknown,
  client: CliApiClient,
): Exclude<ProgressWaiveResult, { ok: true }> {
  if (err instanceof ServerUnreachableError) {
    return { ok: false, reason: 'server_unreachable', serverUrl: client.baseUrl };
  }
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.VALIDATION_ERROR) {
      return { ok: false, reason: 'validation', message: err.message };
    }
    if (err.code === ErrorCode.NOT_FOUND) return { ok: false, reason: 'no_phase' };
    if (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED) {
      return { ok: false, reason: 'unauthenticated' };
    }
  }
  throw err;
}

function presentProgressWaive(result: ProgressWaiveResult, deps: CommandDeps): void {
  if (!result.ok) {
    switch (result.reason) {
      case 'empty_reason':
        deps.errorLog('✗ 사유가 필요합니다\n  cm progress --waive "<사유>"');
        break;
      case 'no_phase':
        deps.errorLog('✗ 진행 중인 Phase가 없습니다');
        break;
      case 'validation':
        deps.errorLog(`✗ ${result.message}`);
        break;
      case 'server_unreachable':
        deps.errorLog(serverUnreachableBlock(result.serverUrl));
        break;
      case 'unauthenticated':
        deps.errorLog(unauthenticatedBlock(false));
        break;
    }
    deps.setExitCode(1);
    return;
  }

  deps.log(
    successBlock(
      'WIP 위반 면제 등록',
      formatFields([
        ['Phase', result.phaseName],
        ['규칙', WIP_RULE],
        ['사유', result.reason],
      ]),
    ),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// 스킬명 → 단계 해석 (§3(4)) — 서버에 보내기 전에 CLI가 막는다
// ─────────────────────────────────────────────

type StageResolveResult =
  | { ok: true; stage: StageSummary; phaseCurrent: PhaseCurrent }
  | { ok: false; reason: 'invalid_skill'; skill: string }
  | PhaseFetchFailure;

async function resolveStageBySkill(
  client: CliApiClient,
  skillInput: string,
): Promise<StageResolveResult> {
  const skill = skillInput.trim().toLowerCase();
  if (!SKILL_VALUES.includes(skill)) {
    return { ok: false, reason: 'invalid_skill', skill: skillInput };
  }

  const phaseFetch = await fetchPhaseCurrent(client);
  if (!phaseFetch.ok) return phaseFetch;

  const stage = phaseFetch.data.stages.find((s) => s.skill === skill);
  if (!stage) {
    // 정상 경로에선 발생하지 않는다 — 부트스트랩·Phase 생성이 항상 7단계를
    // 만든다(DES-002 §5-1). 방어적으로만 다룬다.
    return { ok: false, reason: 'invalid_skill', skill: skillInput };
  }
  return { ok: true, stage, phaseCurrent: phaseFetch.data };
}

function invalidSkillBlock(skill: string): string {
  return `✗ 알 수 없는 스킬입니다: ${skill}\n  사용 가능: ${SKILL_VALUES.join(', ')}`;
}

function precedingStageOf(phaseCurrent: PhaseCurrent, skill: string): StageSummary | undefined {
  const idx = SKILL_VALUES.indexOf(skill);
  if (idx <= 0) return undefined;
  const precedingSkill = SKILL_VALUES[idx - 1];
  return phaseCurrent.stages.find((s) => s.skill === precedingSkill);
}

function inProgressStageOf(
  phaseCurrent: PhaseCurrent,
  excludeSkill: string,
): StageSummary | undefined {
  return phaseCurrent.stages.find(
    (s) => s.status === StageStatus.IN_PROGRESS && s.skill !== excludeSkill,
  );
}

// ─────────────────────────────────────────────
// stage start — SCR-CH09
// ─────────────────────────────────────────────

export type StageStartResult =
  | { ok: true; before: StageSummary; after: StageSummary; precedingStage?: StageSummary }
  | { ok: false; reason: 'invalid_skill'; skill: string }
  | { ok: false; reason: 'no_phase' }
  | { ok: false; reason: 'stage_not_found'; id: string }
  | { ok: false; reason: 'gate_not_passed'; approvalId: string | null }
  | {
      ok: false;
      reason: 'invalid_transition';
      precedingSkill?: string;
      precedingStatus?: string;
      selfStatus?: string;
    }
  | { ok: false; reason: 'wip_violation'; inProgressSkill: string | null }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runStageStart(opts: {
  client: CliApiClient;
  skill: string;
}): Promise<StageStartResult> {
  const resolved = await resolveStageBySkill(opts.client, opts.skill);
  if (!resolved.ok) return resolved;

  const { stage, phaseCurrent } = resolved;
  const precedingStage = precedingStageOf(phaseCurrent, stage.skill);

  try {
    const res = await opts.client.post<{ data: StageSummary }>(`/stages/${stage.id}/start`);
    return { ok: true, before: stage, after: res.data, precedingStage };
  } catch (err) {
    return mapStageStartError(err, opts.client, stage, phaseCurrent);
  }
}

/**
 * 착수 실패의 `INVALID_TRANSITION` 세부 사유를 스냅숏에서 재구성한다 —
 * `stage.service.ts`의 가드 1 판정 순서(자기 자신의 전이 유효성 먼저, 그
 * 다음 직전 단계 완료 여부)를 그대로 따라간다(§주석 "3단 가드 실패 안내"
 * 참조). `mapStageStartError`의 복잡도를 낮추기 위해 분리했다.
 */
function resolveInvalidTransitionFailure(
  stage: StageSummary,
  phaseCurrent: PhaseCurrent,
): Extract<StageStartResult, { reason: 'invalid_transition' }> {
  if (stage.status !== StageStatus.PENDING) {
    return { ok: false, reason: 'invalid_transition', selfStatus: stage.status };
  }
  const preceding = precedingStageOf(phaseCurrent, stage.skill);
  if (preceding && preceding.status !== StageStatus.COMPLETED) {
    return {
      ok: false,
      reason: 'invalid_transition',
      precedingSkill: preceding.skill,
      precedingStatus: preceding.status,
    };
  }
  return { ok: false, reason: 'invalid_transition' };
}

function mapStageStartError(
  err: unknown,
  client: CliApiClient,
  stage: StageSummary,
  phaseCurrent: PhaseCurrent,
): Exclude<StageStartResult, { ok: true }> {
  if (err instanceof ServerUnreachableError) {
    return { ok: false, reason: 'server_unreachable', serverUrl: client.baseUrl };
  }
  if (!(err instanceof ApiRequestError)) throw err;

  if (err.code === ErrorCode.STAGE_NOT_FOUND) {
    return { ok: false, reason: 'stage_not_found', id: stage.id };
  }
  if (err.code === ErrorCode.GATE_NOT_PASSED) {
    return { ok: false, reason: 'gate_not_passed', approvalId: stage.gate.approvalId };
  }
  if (err.code === ErrorCode.WIP_VIOLATION) {
    const inProgress = inProgressStageOf(phaseCurrent, stage.skill);
    return { ok: false, reason: 'wip_violation', inProgressSkill: inProgress?.skill ?? null };
  }
  if (err.code === ErrorCode.INVALID_TRANSITION) {
    return resolveInvalidTransitionFailure(stage, phaseCurrent);
  }
  if (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED) {
    return { ok: false, reason: 'unauthenticated' };
  }
  throw err;
}

function presentStageStart(result: StageStartResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentStageStartFailure(result, deps);
    return;
  }

  const { before, after, precedingStage } = result;
  const gateField = before.gate.required
    ? `필요 · 승인 ${before.gate.approvalId ? shortId(before.gate.approvalId) : '없음'} · 통과`
    : '불필요';
  const precedingField = precedingStage
    ? `${precedingStage.skill} (${stageStatusLabel(precedingStage.status)})`
    : '없음 (첫 단계)';

  const fields = formatFields([
    ['대상 단계', after.skill],
    ['직전 단계', precedingField],
    ['게이트', gateField],
    ['WIP 검사', '통과'],
    ['상태', `${before.status} → ${after.status}`],
    ['착수 시각', after.startedAt ? formatTimestamp(after.startedAt) : '-'],
  ]);

  deps.log(successBlock('단계 착수', fields));
  deps.setExitCode(0);
}

function presentStageStartFailure(
  result: Exclude<StageStartResult, { ok: true }>,
  deps: CommandDeps,
): void {
  switch (result.reason) {
    case 'invalid_skill':
      deps.errorLog(invalidSkillBlock(result.skill));
      break;
    case 'no_phase':
      deps.errorLog('✗ 진행 중인 Phase가 없습니다');
      break;
    case 'stage_not_found':
      deps.errorLog(notFoundBlock('단계', result.id, 'cm progress'));
      break;
    case 'gate_not_passed':
      deps.errorLog(
        result.approvalId
          ? `✗ GATE_NOT_PASSED — 승인 게이트를 통과하지 못했습니다\n` +
              `  필요한 승인 ID: ${shortId(result.approvalId)}\n` +
              `  cm review ${shortId(result.approvalId)}`
          : '✗ GATE_NOT_PASSED — 승인 게이트를 통과하지 못했습니다\n' +
              '  아직 게이트 승인 건이 상정되지 않았습니다',
      );
      break;
    case 'invalid_transition':
      if (result.precedingSkill) {
        // 직전 단계가 아직 pending이면 먼저 착수해야 한다 — in_progress일 때만
        // "완료하세요"가 맞는 조치다(착수 전 단계에 complete를 권하면 그 자체가
        // 또 INVALID_TRANSITION이 난다).
        const precedingHint =
          result.precedingStatus === StageStatus.IN_PROGRESS
            ? `cm stage complete ${result.precedingSkill}`
            : `cm stage start ${result.precedingSkill}`;
        deps.errorLog(
          `✗ INVALID_TRANSITION — 직전 단계가 완료되지 않았습니다\n` +
            `  직전 단계: ${result.precedingSkill} (${stageStatusLabel(result.precedingStatus as string)})\n` +
            `  ${precedingHint}`,
        );
      } else if (result.selfStatus) {
        deps.errorLog(
          `✗ INVALID_TRANSITION — 이미 ${stageStatusLabel(result.selfStatus)} 상태인 단계는 착수할 수 없습니다`,
        );
      } else {
        deps.errorLog('✗ INVALID_TRANSITION — 착수할 수 없는 상태입니다');
      }
      break;
    case 'wip_violation':
      deps.errorLog(
        `✗ WIP_VIOLATION — WIP=1 규칙을 위반합니다\n` +
          `  진행 중 단계: ${result.inProgressSkill ?? '알 수 없음'}\n` +
          `  cm progress --waive "<사유>"`,
      );
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
// stage complete — SCR-CH14 (가드는 상태 검사 하나뿐 — R-03, 개발 지시 §2)
// ─────────────────────────────────────────────

export type StageCompleteResult =
  | { ok: true; before: StageSummary; after: StageSummary }
  | { ok: false; reason: 'invalid_skill'; skill: string }
  | { ok: false; reason: 'no_phase' }
  | { ok: false; reason: 'stage_not_found'; id: string }
  | { ok: false; reason: 'invalid_transition'; status: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runStageComplete(opts: {
  client: CliApiClient;
  skill: string;
}): Promise<StageCompleteResult> {
  const resolved = await resolveStageBySkill(opts.client, opts.skill);
  if (!resolved.ok) return resolved;

  const { stage } = resolved;
  try {
    const res = await opts.client.post<{ data: StageSummary }>(`/stages/${stage.id}/complete`);
    return { ok: true, before: stage, after: res.data };
  } catch (err) {
    return mapStageCompleteError(err, opts.client, stage);
  }
}

function mapStageCompleteError(
  err: unknown,
  client: CliApiClient,
  stage: StageSummary,
): Exclude<StageCompleteResult, { ok: true }> {
  if (err instanceof ServerUnreachableError) {
    return { ok: false, reason: 'server_unreachable', serverUrl: client.baseUrl };
  }
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.STAGE_NOT_FOUND) {
      return { ok: false, reason: 'stage_not_found', id: stage.id };
    }
    if (err.code === ErrorCode.INVALID_TRANSITION) {
      return { ok: false, reason: 'invalid_transition', status: stage.status };
    }
    if (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED) {
      return { ok: false, reason: 'unauthenticated' };
    }
  }
  throw err;
}

function presentStageComplete(result: StageCompleteResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentStageCompleteFailure(result, deps);
    return;
  }

  const { before, after } = result;
  const fields = formatFields([
    ['대상 단계', after.skill],
    ['처리 전 상태', stageStatusLabel(before.status)],
    ['상태', `${before.status} → ${after.status}`],
    ['완료 시각', after.completedAt ? formatTimestamp(after.completedAt) : '-'],
  ]);

  // EVT-CH14-1 — current_stage는 이 명령이 바꾸지 않는다는 고지
  deps.log(
    successBlock(
      '단계 완료',
      `${fields}\n\n다음 단계는 cm stage start <skill>로 착수하세요 (현재 단계는 바뀌지 않습니다)`,
    ),
  );
  deps.setExitCode(0);
}

function presentStageCompleteFailure(
  result: Exclude<StageCompleteResult, { ok: true }>,
  deps: CommandDeps,
): void {
  switch (result.reason) {
    case 'invalid_skill':
      deps.errorLog(invalidSkillBlock(result.skill));
      break;
    case 'no_phase':
      deps.errorLog('✗ 진행 중인 Phase가 없습니다');
      break;
    case 'stage_not_found':
      deps.errorLog(notFoundBlock('단계', result.id, 'cm progress'));
      break;
    case 'invalid_transition':
      deps.errorLog(
        `✗ INVALID_TRANSITION — 진행 중 단계만 완료할 수 있습니다\n` +
          `  현재 상태: ${stageStatusLabel(result.status)}`,
      );
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
// artifacts — SCR-CH10
// ─────────────────────────────────────────────

export type ArtifactsResult =
  | { ok: true; items: Artifact[]; sync?: string }
  | { ok: false; reason: 'invalid_sync'; value: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runArtifacts(opts: {
  client: CliApiClient;
  sync?: string;
}): Promise<ArtifactsResult> {
  if (opts.sync !== undefined && !SYNC_STATUS_VALUES.includes(opts.sync)) {
    return { ok: false, reason: 'invalid_sync', value: opts.sync };
  }

  try {
    const qs = opts.sync ? `?syncStatus=${encodeURIComponent(opts.sync)}` : '';
    const res = await opts.client.get<{ data: Artifact[] }>(`/artifacts${qs}`);
    return { ok: true, items: res.data, sync: opts.sync };
  } catch (err) {
    if (err instanceof ServerUnreachableError) {
      return { ok: false, reason: 'server_unreachable', serverUrl: opts.client.baseUrl };
    }
    if (
      err instanceof ApiRequestError &&
      (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED)
    ) {
      return { ok: false, reason: 'unauthenticated' };
    }
    throw err;
  }
}

function artifactRow(a: Artifact): string[] {
  return [
    a.code,
    truncateName(a.title),
    a.status,
    a.syncStatus,
    a.notionUrl ? '✅' : '❌',
    a.gitPath ? '✅' : '❌',
    formatTimestamp(a.updatedAt),
  ];
}

function presentArtifacts(result: ArtifactsResult, deps: CommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'invalid_sync') {
      deps.errorLog(
        `✗ 알 수 없는 동기화 상태입니다: ${result.value}\n  사용 가능: ${SYNC_STATUS_VALUES.join(', ')}`,
      );
    } else if (result.reason === 'server_unreachable') {
      deps.errorLog(serverUnreachableBlock(result.serverUrl));
    } else {
      deps.errorLog(unauthenticatedBlock(false));
    }
    deps.setExitCode(1);
    return;
  }

  if (result.items.length === 0) {
    deps.log(successBlock('산출물 목록', '산출물이 없습니다'));
    deps.setExitCode(0);
    return;
  }

  const headers = ['코드', '제목', '상태', '동기화', 'Notion', 'Git', '최종수정'];
  const minWidths = [8, NAME_MAX_LEN, 8, 11, 6, 3, 19];
  const table = renderTable(headers, result.items.map(artifactRow), minWidths);

  // EVT-CH10-1·SCR-CH10 경고블록 — notion_only는 동기화 누락이지 프로세스
  // 위반이 아니다(`cm review`와 표기 일치, 개발 지시 §3(3))
  const notionOnlyCount = result.items.filter(
    (a) => a.syncStatus === SyncStatus.NOTION_ONLY,
  ).length;
  const warning =
    notionOnlyCount > 0
      ? `\n\n⚠ notion_only ${notionOnlyCount}건 — 동기화 누락이지 프로세스 위반이 아닙니다 (Notion에는 존재합니다)`
      : '';

  const filters = result.sync ? [`sync=${result.sync}`] : [];
  deps.log(
    successBlock(
      '산출물 목록',
      `${table}\n\n${totalFooter(result.items.length, filters)}${warning}`,
    ),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// artifacts add — D-3 (신설, 대표 승인)
// ─────────────────────────────────────────────
//
// `ArtifactService.upsert()`는 이미 구현돼 있었으나 이를 배선하는 HTTP
// 라우트도 CLI 명령도 없어 FR-031 전체가 도달 불가능했다(설계 공백,
// D-3 조사 결과). `POST /api/artifacts`를 그대로 호출한다.
//
// `--stage <uuid>` 대신 `--skill <skill>`을 받는다 — `resolveStageBySkill`
// (위, `stage start/complete`가 이미 쓰는 헬퍼)을 그대로 재사용해 스킬명을
// 그 스킬의 현재 Phase 단계 id로 해석한다. 대표가 raw UUID를 외워 입력할
// 필요가 없고, 존재하지 않는 stage를 상정하는 경로 자체가 차단된다
// (진행 중인 Phase의 7단계 중 하나로만 좁혀진다) — `cm progress`가 raw
// stage id를 아예 노출하지 않는 것과 같은 이유(§3-1 상단 주석 "응답
// 필드에 없는 것을 화면에 만들지 않는다").

export type ArtifactsAddResult =
  | { ok: true; artifact: Artifact }
  | { ok: false; reason: 'invalid_skill'; skill: string }
  | { ok: false; reason: 'no_phase' }
  | { ok: false; reason: 'validation'; message: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runArtifactsAdd(opts: {
  client: CliApiClient;
  skill: string;
  code: string;
  title: string;
  notionUrl?: string;
  gitPath?: string;
}): Promise<ArtifactsAddResult> {
  const resolved = await resolveStageBySkill(opts.client, opts.skill);
  if (!resolved.ok) return resolved;

  try {
    const res = await opts.client.post<{ data: Artifact }>('/artifacts', {
      stageId: resolved.stage.id,
      code: opts.code,
      title: opts.title,
      notionUrl: opts.notionUrl,
      gitPath: opts.gitPath,
    });
    return { ok: true, artifact: res.data };
  } catch (err) {
    return mapArtifactsAddError(err, opts.client);
  }
}

function mapArtifactsAddError(
  err: unknown,
  client: CliApiClient,
): Exclude<ArtifactsAddResult, { ok: true }> {
  if (err instanceof ServerUnreachableError) {
    return { ok: false, reason: 'server_unreachable', serverUrl: client.baseUrl };
  }
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.VALIDATION_ERROR) {
      return { ok: false, reason: 'validation', message: err.message };
    }
    if (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED) {
      return { ok: false, reason: 'unauthenticated' };
    }
  }
  throw err;
}

function presentArtifactsAdd(result: ArtifactsAddResult, deps: CommandDeps): void {
  if (!result.ok) {
    switch (result.reason) {
      case 'invalid_skill':
        deps.errorLog(invalidSkillBlock(result.skill));
        break;
      case 'no_phase':
        deps.errorLog('✗ 진행 중인 Phase가 없습니다');
        break;
      case 'validation':
        deps.errorLog(`✗ ${result.message}`);
        break;
      case 'server_unreachable':
        deps.errorLog(serverUnreachableBlock(result.serverUrl));
        break;
      case 'unauthenticated':
        deps.errorLog(unauthenticatedBlock(false));
        break;
    }
    deps.setExitCode(1);
    return;
  }

  const a = result.artifact;
  deps.log(
    successBlock(
      '산출물 등록 완료',
      formatFields([
        ['코드', a.code],
        ['제목', a.title],
        ['상태', a.status],
        ['동기화', a.syncStatus],
        ['최종수정', formatTimestamp(a.updatedAt)],
      ]),
    ),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// Commander 연결
// ─────────────────────────────────────────────

export function registerProgressCommand(
  program: Command,
  overrides: Partial<CommandDeps> = {},
): void {
  const deps: CommandDeps = { ...defaultCommandDeps(), ...overrides };
  const now = deps.now ?? (() => new Date());

  program
    .command('progress')
    .description('Phase 진행 보드를 조회한다 (SCR-CH06)')
    .option('--waive <사유>', 'WIP 위반 면제를 등록한다 (POST /api/wip-waivers)')
    .action(async (opts: { waive?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);

      if (opts.waive !== undefined) {
        const result = await runProgressWaive({
          client: deps.createClient(),
          reasonInput: opts.waive,
        });
        presentProgressWaive(result, deps);
        return;
      }

      const result = await runProgress({ client: deps.createClient() });
      presentProgress(result, deps, now);
    });

  const stage = program.command('stage').description('단계 착수·완료');

  stage
    .command('start')
    .description('단계를 착수한다 — 게이트 3단 검증 (SCR-CH09)')
    .argument('<skill>', `스킬명 (${SKILL_VALUES.join('|')})`)
    .action(async (skill: string) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runStageStart({ client: deps.createClient(), skill });
      presentStageStart(result, deps);
    });

  stage
    .command('complete')
    .description('단계를 완료한다 (SCR-CH14)')
    .argument('<skill>', `스킬명 (${SKILL_VALUES.join('|')})`)
    .action(async (skill: string) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runStageComplete({ client: deps.createClient(), skill });
      presentStageComplete(result, deps);
    });

  const artifacts = program
    .command('artifacts')
    .description('산출물 + 동기화 상태를 조회한다 (SCR-CH10)')
    .option('--sync <상태>', `동기화 상태 필터 (${SYNC_STATUS_VALUES.join('|')})`)
    .action(async (opts: { sync?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runArtifacts({ client: deps.createClient(), sync: opts.sync });
      presentArtifacts(result, deps);
    });

  artifacts
    .command('add')
    .description('산출물을 등록·갱신한다 — code 기준 upsert (D-3, 신설)')
    .requiredOption('--skill <skill>', `단계 스킬명 (${SKILL_VALUES.join('|')})`)
    .requiredOption('--code <code>', '산출물 코드 (예: PLN-001)')
    .requiredOption('--title <title>', '산출물 제목')
    .option('--notion-url <url>', 'Notion 문서 URL')
    .option('--git-path <path>', 'Git 저장소 내 경로')
    .action(
      async (opts: {
        skill: string;
        code: string;
        title: string;
        notionUrl?: string;
        gitPath?: string;
      }) => {
        const guard = checkAuth(deps.homeDir, deps.now);
        if (!guard.ok) return presentAuthGuardFailure(guard, deps);
        const result = await runArtifactsAdd({
          client: deps.createClient(),
          skill: opts.skill,
          code: opts.code,
          title: opts.title,
          notionUrl: opts.notionUrl,
          gitPath: opts.gitPath,
        });
        presentArtifactsAdd(result, deps);
      },
    );
}
