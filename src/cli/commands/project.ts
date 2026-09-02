import type { Command } from 'commander';
import { ErrorCode, ProjectStatus } from '../../shared/constants.js';
import { PROJECT_TRANSITIONS } from '../../shared/state-transitions.js';
import type { Agent, Project, ProjectDetail } from '../../shared/types.js';
import { ApiRequestError } from '../api-client.js';
import {
  formatFields,
  formatTimestamp,
  ID_SHORT_LEN,
  NAME_MAX_LEN,
  paginationFooter,
  renderTable,
  shortId,
  successBlock,
  truncateName,
} from '../output.js';
import {
  ambiguousIdBlock,
  type CascadeItem,
  type CliApiClient,
  type CommandDeps,
  cascadeBlock,
  checkAuth,
  defaultCommandDeps,
  diffCascade,
  mapCommonApiError,
  notFoundBlock,
  presentAuthGuardFailure,
  resolveId,
  serverUnreachableBlock,
  toIdLookupFailure,
  unauthenticatedBlock,
} from '../runtime.js';

/**
 * `cm project create/list/status` — SCR-P01~P04
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-P01~P04 · §3 표시 데이터 · §4-2 EVT-P01~P04
 *
 * `commands/auth.ts`의 관용구를 그대로 따른다: 판정 로직(run*)은 콘솔에
 * 아무것도 쓰지 않고 판별 유니온만 돌려주고, `present*`가 그 결과를
 * §8 출력 형식으로 바꾼다. ID 접두어 해석·인증 가드·캐스케이드 diff는
 * `runtime.ts`(이 그룹이 새로 굳힌 공용 골격)를 거친다.
 */

const PROJECT_STATUS_VALUES = Object.values(ProjectStatus);

// ─────────────────────────────────────────────
// create — SCR-P01
// ─────────────────────────────────────────────

export type ProjectCreateResult =
  | { ok: true; project: Project }
  | { ok: false; reason: 'name_conflict'; name: string }
  | { ok: false; reason: 'validation'; message: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runProjectCreate(opts: {
  client: CliApiClient;
  name: string;
  description?: string;
}): Promise<ProjectCreateResult> {
  try {
    const res = await opts.client.post<{ data: Project }>('/projects', {
      name: opts.name,
      description: opts.description,
    });
    return { ok: true, project: res.data };
  } catch (err) {
    if (err instanceof ApiRequestError) {
      if (err.code === ErrorCode.PROJECT_NAME_CONFLICT) {
        return { ok: false, reason: 'name_conflict', name: opts.name };
      }
      if (err.code === ErrorCode.VALIDATION_ERROR) {
        return { ok: false, reason: 'validation', message: err.message };
      }
    }
    return mapCommonApiError(err, opts.client);
  }
}

function presentProjectCreate(result: ProjectCreateResult, deps: CommandDeps): void {
  if (result.ok) {
    const p = result.project;
    deps.log(
      successBlock(
        '프로젝트 생성 완료',
        formatFields([
          ['ID', p.id],
          ['이름', p.name],
          ['상태', p.status],
          ['설명', p.description],
          ['생성일시', formatTimestamp(p.createdAt)],
        ]),
      ),
    );
    deps.setExitCode(0);
    return;
  }

  switch (result.reason) {
    case 'name_conflict':
      deps.errorLog(`✗ 이미 존재하는 이름입니다: ${result.name}`);
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
}

// ─────────────────────────────────────────────
// list — SCR-P02
// ─────────────────────────────────────────────

export type ProjectListResult =
  | { ok: true; items: Project[]; page: number; totalPages: number; total: number; status?: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runProjectList(opts: {
  client: CliApiClient;
  status?: string;
  page: number;
}): Promise<ProjectListResult> {
  try {
    const qs = new URLSearchParams({ page: String(opts.page) });
    if (opts.status) qs.set('status', opts.status);
    const res = await opts.client.get<{
      data: Project[];
      pagination: { page: number; totalPages: number; total: number };
    }>(`/projects?${qs.toString()}`);
    return {
      ok: true,
      items: res.data,
      page: res.pagination.page,
      totalPages: res.pagination.totalPages,
      total: res.pagination.total,
      status: opts.status,
    };
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
}

function presentProjectList(result: ProjectListResult, deps: CommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'server_unreachable')
      deps.errorLog(serverUnreachableBlock(result.serverUrl));
    else deps.errorLog(unauthenticatedBlock(false));
    deps.setExitCode(1);
    return;
  }

  if (result.items.length === 0) {
    deps.log(
      `${successBlock('프로젝트 목록', '프로젝트가 없습니다')}\n\n  cm project create --name <이름>`,
    );
    deps.setExitCode(0);
    return;
  }

  const rows = result.items.map((p) => [
    shortId(p.id),
    truncateName(p.name),
    p.status,
    formatTimestamp(p.createdAt),
  ]);
  const table = renderTable(['ID', '이름', '상태', '생성일시'], rows, [
    ID_SHORT_LEN,
    NAME_MAX_LEN,
    10,
    19,
  ]);
  const footer = paginationFooter(
    { page: result.page, pageSize: 0, total: result.total, totalPages: result.totalPages },
    result.status ? [result.status] : [],
  );
  deps.log(successBlock('프로젝트 목록', `${table}\n\n${footer}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// status (조회) — SCR-P03
// ─────────────────────────────────────────────

export type ProjectDetailResult =
  | { ok: true; project: ProjectDetail }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runProjectDetail(opts: {
  client: CliApiClient;
  idOrPrefix: string;
}): Promise<ProjectDetailResult> {
  // REV-H-03 — resolveId 호출을 try로 감싼다
  let resolved: Awaited<ReturnType<typeof resolveId<Project>>>;
  try {
    resolved = await resolveId<Project>(opts.client, '/projects', opts.idOrPrefix, (p) => p.name);
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
  if (!resolved.ok) return toIdLookupFailure(resolved, opts.idOrPrefix);

  try {
    const res = await opts.client.get<{ data: ProjectDetail }>(`/projects/${resolved.id}`);
    return { ok: true, project: res.data };
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === ErrorCode.PROJECT_NOT_FOUND) {
      return { ok: false, reason: 'not_found', id: opts.idOrPrefix };
    }
    return mapCommonApiError(err, opts.client);
  }
}

/**
 * DES-006 SCR-P03이 요구하는 "허용 상태 전이 목록"은 `GET /api/projects/:id`
 * 응답 필드에 없다(ProjectDetail = Project + agents). 에러 응답의
 * `details.allowedTransitions`(DEV-D-04)는 전이가 실패했을 때만 실린다 —
 * 상세 조회(성공 경로)에는 애초에 없다. `shared/state-transitions.js`가
 * 백엔드 `state-machine.ts`와 CLI가 함께 참조하는 단일 원본이므로(DES-008
 * "상태 전이 규칙 데이터 — 백엔드/CLI 공유"), 여기서 직접 조회한다 — 백엔드
 * API를 넓히지 않고도 정확히 같은 규칙을 쓴다.
 */
function allowedProjectTransitions(status: string): readonly string[] {
  return PROJECT_TRANSITIONS[status as ProjectStatus] ?? [];
}

function presentProjectDetail(result: ProjectDetailResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentIdOrCommonFailure(result, deps, '프로젝트', 'cm project list');
    return;
  }

  const p = result.project;
  const fields = formatFields([
    ['ID', p.id],
    ['이름', p.name],
    ['상태', p.status],
    ['설명', p.description],
    ['생성일시', formatTimestamp(p.createdAt)],
    ['수정일시', formatTimestamp(p.updatedAt)],
  ]);

  let agentsBlock: string;
  if (p.agents.length === 0) {
    agentsBlock = `  Agent: 없음\n  cm agent create --project ${p.id}`;
  } else {
    const rows = p.agents.map((a) => [
      shortId(a.id),
      truncateName(a.name),
      a.type,
      a.status,
      a.skill,
    ]);
    const table = renderTable(['ID', '이름', '유형', '상태', '스킬'], rows, [
      ID_SHORT_LEN,
      NAME_MAX_LEN,
      0,
      10,
      0,
    ]);
    agentsBlock = table
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n');
  }

  const allowed = allowedProjectTransitions(p.status);
  const allowedLine =
    allowed.length > 0 ? `  허용 상태 전이: ${allowed.join(', ')}` : '  종료된 프로젝트입니다';

  deps.log(successBlock('프로젝트 상세', `${fields}\n\n${agentsBlock}\n\n${allowedLine}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// status --set (변경) — SCR-P04
// ─────────────────────────────────────────────

export type ProjectStatusChangeResult =
  | { ok: true; project: Project; from: string; to: string; cascade?: CascadeItem[] }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'invalid_transition'; message: string; allowed: string[] }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

/** 실패해도 `null` — 캐스케이드 표시는 부가 정보이지 상태 전이의 성공 조건이 아니다 */
async function fetchProjectDetailQuietly(
  client: CliApiClient,
  id: string,
): Promise<ProjectDetail | null> {
  try {
    return (await client.get<{ data: ProjectDetail }>(`/projects/${id}`)).data;
  } catch {
    return null;
  }
}

function mapProjectStatusChangeError(
  err: unknown,
  client: CliApiClient,
  idOrPrefix: string,
): ProjectStatusChangeResult {
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.PROJECT_NOT_FOUND) {
      return { ok: false, reason: 'not_found', id: idOrPrefix };
    }
    if (err.code === ErrorCode.INVALID_TRANSITION) {
      const allowed = (err.details?.allowedTransitions as string[] | undefined) ?? [];
      return { ok: false, reason: 'invalid_transition', message: err.message, allowed };
    }
  }
  return mapCommonApiError(err, client);
}

export async function runProjectStatusChange(opts: {
  client: CliApiClient;
  idOrPrefix: string;
  newStatus: string;
}): Promise<ProjectStatusChangeResult> {
  // REV-H-03 — resolveId 호출을 try로 감싼다
  let resolved: Awaited<ReturnType<typeof resolveId<Project>>>;
  try {
    resolved = await resolveId<Project>(opts.client, '/projects', opts.idOrPrefix, (p) => p.name);
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
  if (!resolved.ok) return toIdLookupFailure(resolved, opts.idOrPrefix);

  // "이전상태 → 이후상태"(SCR-P04)를 보여주려면 전이 전 상태가 필요하다 —
  // PATCH 응답은 이후 상태만 준다. 항상 조회해 둔다(취소 여부와 무관).
  const before = await fetchProjectDetailQuietly(opts.client, resolved.id);

  try {
    const res = await opts.client.patch<{ data: Project }>(`/projects/${resolved.id}/status`, {
      status: opts.newStatus,
    });
    const project = res.data;

    // (취소 시) 캐스케이드 대상 전체 목록(SCR-P04) — PATCH 응답엔 캐스케이드
    // 정보가 없어 전이 후 스냅샷을 다시 떠 diffCascade로 비교한다(runtime.ts).
    const after =
      before && opts.newStatus === ProjectStatus.CANCELLED
        ? await fetchProjectDetailQuietly(opts.client, resolved.id)
        : null;
    const cascade =
      before && after ? diffCascade<Agent>(before.agents, after.agents, (a) => a.name) : undefined;

    return { ok: true, project, from: before?.status ?? '', to: project.status, cascade };
  } catch (err) {
    return mapProjectStatusChangeError(err, opts.client, opts.idOrPrefix);
  }
}

function presentProjectStatusChange(result: ProjectStatusChangeResult, deps: CommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'invalid_transition') {
      const hint =
        result.allowed.length > 0 ? `허용된 전이: ${result.allowed.join(', ')}` : undefined;
      deps.errorLog(hint ? `✗ ${result.message}\n  ${hint}` : `✗ ${result.message}`);
      deps.setExitCode(1);
      return;
    }
    presentIdOrCommonFailure(result, deps, '프로젝트', 'cm project list');
    return;
  }

  const p = result.project;
  const fields = formatFields([
    ['프로젝트명', p.name],
    ['ID', p.id],
    ['전이', `${result.from} → ${result.to}`],
    ['변경일시', formatTimestamp(p.updatedAt)],
  ]);
  const body =
    result.cascade && result.cascade.length > 0
      ? `${fields}\n\n${cascadeBlock(`캐스케이드: Agent ${result.cascade.length}건`, result.cascade)}`
      : fields;

  deps.log(successBlock('상태 변경 완료', body));
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
// Commander 연결
// ─────────────────────────────────────────────

export function registerProjectCommand(
  program: Command,
  overrides: Partial<CommandDeps> = {},
): void {
  const deps: CommandDeps = { ...defaultCommandDeps(), ...overrides };
  const project = program.command('project').description('프로젝트 관리');

  project
    .command('create')
    .description('프로젝트를 생성한다 (SCR-P01)')
    .requiredOption('--name <name>', '프로젝트 이름')
    .option('--description <description>', '프로젝트 설명')
    .action(async (opts: { name: string; description?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runProjectCreate({
        client: deps.createClient(),
        name: opts.name,
        description: opts.description,
      });
      presentProjectCreate(result, deps);
    });

  project
    .command('list')
    .description('프로젝트 목록을 조회한다 (SCR-P02)')
    .option('--status <status>', `상태 필터 (${PROJECT_STATUS_VALUES.join('|')})`)
    .option('--page <page>', '페이지 번호', '1')
    .action(async (opts: { status?: string; page: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runProjectList({
        client: deps.createClient(),
        status: opts.status,
        page: Number(opts.page),
      });
      presentProjectList(result, deps);
    });

  project
    .command('status')
    .description('프로젝트 상세를 조회하거나 상태를 변경한다 (SCR-P03·SCR-P04)')
    .argument('<id>', '프로젝트 ID (전체 또는 앞 8자리)')
    .option('--set <status>', `변경할 상태 (${PROJECT_STATUS_VALUES.join('|')})`)
    .action(async (id: string, opts: { set?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const client = deps.createClient();

      if (opts.set) {
        const result = await runProjectStatusChange({
          client,
          idOrPrefix: id,
          newStatus: opts.set,
        });
        presentProjectStatusChange(result, deps);
        return;
      }

      const result = await runProjectDetail({ client, idOrPrefix: id });
      presentProjectDetail(result, deps);
    });
}
