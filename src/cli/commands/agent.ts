import type { Command } from 'commander';
import { AgentStatus, ErrorCode } from '../../shared/constants.js';
import { AGENT_TRANSITIONS } from '../../shared/state-transitions.js';
import type { Agent, AgentDetail, DeleteAgentResult, Project, Task } from '../../shared/types.js';
import { ApiRequestError, ServerUnreachableError } from '../api-client.js';
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
  defaultPromptConfirm,
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
 * `cm agent create/list/status/delete` — SCR-AG01~AG05
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-AG01~AG05 · §3 표시 데이터 · §4-3 EVT-AG01~AG05
 * · §5 PRM-02·PRM-03
 *
 * `commands/project.ts`(이 그룹의 첫 파일)와 같은 관용구를 쓴다. project.ts와
 * 다른 점은 두 가지뿐이다: ① 생성 결과가 "소속 프로젝트(이름+ID)"를 요구해
 * `POST` 성공 뒤 프로젝트 이름을 한 번 더 조회한다(§3 SCR-AG01, project.ts엔
 * 없는 요구). ② 삭제(SCR-AG05)는 파괴적 작업이라 `PRM-02`/`PRM-03` 확인
 * 프롬프트를 거친다(auth.ts `defaultPromptSecret`과 같은 TTY 가드 원칙).
 */

const AGENT_STATUS_VALUES = Object.values(AgentStatus);

/** DES-006 §3 SCR-AG03 "재시도 n/3" — 최대 재시도 횟수(DES-007 §3 "재시도 횟수 < 3") */
const MAX_RETRY_COUNT = 3;

interface AgentCommandDeps extends CommandDeps {
  promptConfirm: (question: string) => Promise<string>;
}

function defaultAgentCommandDeps(): AgentCommandDeps {
  return { ...defaultCommandDeps(), promptConfirm: defaultPromptConfirm };
}

// ─────────────────────────────────────────────
// create — SCR-AG01
// ─────────────────────────────────────────────

export type AgentCreateResult =
  | { ok: true; agent: Agent; projectName: string }
  | { ok: false; reason: 'project_not_found'; projectId: string }
  | { ok: false; reason: 'ambiguous_project'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'name_conflict'; name: string }
  | { ok: false; reason: 'validation'; message: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

function mapAgentCreateError(
  err: unknown,
  client: CliApiClient,
  projectId: string,
  name: string,
): AgentCreateResult {
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.PROJECT_NOT_FOUND)
      return { ok: false, reason: 'project_not_found', projectId };
    if (err.code === ErrorCode.AGENT_NAME_CONFLICT)
      return { ok: false, reason: 'name_conflict', name };
    if (err.code === ErrorCode.VALIDATION_ERROR)
      return { ok: false, reason: 'validation', message: err.message };
  }
  return mapCommonApiError(err, client);
}

export async function runAgentCreate(opts: {
  client: CliApiClient;
  projectId: string;
  name: string;
  type?: string;
  skill?: string;
}): Promise<AgentCreateResult> {
  // `--project`는 §8 ID 축약 규칙("명령어 인자: 앞 8자리 허용")의 적용
  // 대상이다 — `project list`가 8자만 보여주므로 대표가 그걸 그대로
  // 복사해 넣는다. 접두어를 그대로 POST에 실으면 백엔드가 정확히 일치하는
  // UUID만 찾아 항상 PROJECT_NOT_FOUND가 난다.
  // REV-H-03 — `resolveId`는 내부에서 실제 HTTP 요청을 보낸다. try 밖에 두면
  // 서버 unreachable·토큰 만료가 §8 공통 에러 안내를 우회한다.
  let resolvedProject: Awaited<ReturnType<typeof resolveId<Project>>>;
  try {
    resolvedProject = await resolveId<Project>(
      opts.client,
      '/projects',
      opts.projectId,
      (p) => p.name,
    );
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
  if (!resolvedProject.ok) {
    if (resolvedProject.reason === 'not_found') {
      return { ok: false, reason: 'project_not_found', projectId: opts.projectId };
    }
    return { ok: false, reason: 'ambiguous_project', candidates: resolvedProject.candidates };
  }
  const projectId = resolvedProject.id;

  try {
    const res = await opts.client.post<{ data: Agent }>('/agents', {
      projectId,
      name: opts.name,
      type: opts.type,
      skill: opts.skill,
    });
    const agent = res.data;

    // "소속 프로젝트(이름+ID)"(§3 SCR-AG01) — Agent 응답엔 projectId뿐이라
    // 이름을 보여주려면 한 번 더 조회해야 한다. 실패해도 생성 자체는 성공했으니
    // ID로 대체 표시한다(부가 정보 실패로 생성 성공을 무효화하지 않는다).
    let projectName = agent.projectId;
    try {
      const project = await opts.client.get<{ data: Project }>(`/projects/${agent.projectId}`);
      projectName = project.data.name;
    } catch {
      projectName = agent.projectId;
    }

    return { ok: true, agent, projectName };
  } catch (err) {
    return mapAgentCreateError(err, opts.client, projectId, opts.name);
  }
}

function presentAgentCreate(result: AgentCreateResult, deps: CommandDeps): void {
  if (result.ok) {
    const a = result.agent;
    deps.log(
      successBlock(
        'Agent 생성 완료',
        formatFields([
          ['ID', a.id],
          ['이름', a.name],
          ['유형', a.type],
          ['프로젝트', `${result.projectName} (${a.projectId})`],
          ['스킬', a.skill],
          ['상태', a.status],
          ['생성일시', formatTimestamp(a.createdAt)],
        ]),
      ),
    );
    deps.setExitCode(0);
    return;
  }

  switch (result.reason) {
    case 'project_not_found':
      deps.errorLog(notFoundBlock('프로젝트', result.projectId, 'cm project list'));
      break;
    case 'ambiguous_project':
      deps.errorLog(ambiguousIdBlock(result.candidates));
      break;
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
// list — SCR-AG02
// ─────────────────────────────────────────────

export type AgentListResult =
  | {
      ok: true;
      items: Agent[];
      page: number;
      totalPages: number;
      total: number;
      status?: string;
      projectId?: string;
    }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runAgentList(opts: {
  client: CliApiClient;
  projectId?: string;
  status?: string;
  page: number;
}): Promise<AgentListResult> {
  // --project도 §8 ID 축약 규칙 대상이다 — 접두어를 그대로 필터에 실으면
  // 정확히 일치하는 값이 없어 "결과 0건"으로 조용히 보인다(runAgentCreate와
  // 같은 함정). 필터가 있을 때만 해석한다.
  let projectId = opts.projectId;
  if (projectId) {
    // REV-H-03 — resolveId의 내부 HTTP 호출을 try로 감싼다 (agent.ts 파일
    // 헤더의 원칙 참조: 이 함수의 최종 조회와 같은 매핑을 공유한다).
    try {
      const resolved = await resolveId<Project>(opts.client, '/projects', projectId, (p) => p.name);
      if (!resolved.ok) return toIdLookupFailure(resolved, projectId);
      projectId = resolved.id;
    } catch (err) {
      return mapCommonApiError(err, opts.client);
    }
  }

  try {
    const qs = new URLSearchParams({ page: String(opts.page) });
    if (opts.status) qs.set('status', opts.status);
    if (projectId) qs.set('projectId', projectId);
    const res = await opts.client.get<{
      data: Agent[];
      pagination: { page: number; totalPages: number; total: number };
    }>(`/agents?${qs.toString()}`);
    return {
      ok: true,
      items: res.data,
      page: res.pagination.page,
      totalPages: res.pagination.totalPages,
      total: res.pagination.total,
      status: opts.status,
      projectId,
    };
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
}

function presentAgentList(result: AgentListResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentIdOrCommonFailure(result, deps, '프로젝트', 'cm project list');
    return;
  }

  if (result.items.length === 0) {
    deps.log(
      `${successBlock('Agent 목록', 'Agent가 없습니다')}\n\n  cm agent create --project <id>`,
    );
    deps.setExitCode(0);
    return;
  }

  const rows = result.items.map((a) => [
    shortId(a.id),
    truncateName(a.name),
    a.type,
    a.skill,
    a.status,
    formatTimestamp(a.createdAt),
  ]);
  const table = renderTable(['ID', '이름', '유형', '스킬', '상태', '생성일시'], rows, [
    ID_SHORT_LEN,
    NAME_MAX_LEN,
    0,
    0,
    10,
    19,
  ]);
  const filters = [result.status, result.projectId].filter((v): v is string => Boolean(v));
  const footer = paginationFooter(
    { page: result.page, pageSize: 0, total: result.total, totalPages: result.totalPages },
    filters,
  );
  deps.log(successBlock('Agent 목록', `${table}\n\n${footer}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// status (조회) — SCR-AG03
// ─────────────────────────────────────────────

export type AgentDetailResult =
  | { ok: true; agent: AgentDetail }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runAgentDetail(opts: {
  client: CliApiClient;
  idOrPrefix: string;
}): Promise<AgentDetailResult> {
  // REV-H-03 — resolveId 호출을 try로 감싼다 (파일 헤더 원칙 참조)
  let resolved: Awaited<ReturnType<typeof resolveId<Agent>>>;
  try {
    resolved = await resolveId<Agent>(opts.client, '/agents', opts.idOrPrefix, (a) => a.name);
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
  if (!resolved.ok) return toIdLookupFailure(resolved, opts.idOrPrefix);

  try {
    const res = await opts.client.get<{ data: AgentDetail }>(`/agents/${resolved.id}`);
    return { ok: true, agent: res.data };
  } catch (err) {
    if (err instanceof ApiRequestError && err.code === ErrorCode.AGENT_NOT_FOUND) {
      return { ok: false, reason: 'not_found', id: opts.idOrPrefix };
    }
    return mapCommonApiError(err, opts.client);
  }
}

function presentAgentDetail(result: AgentDetailResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentIdOrCommonFailure(result, deps, 'Agent', 'cm agent list');
    return;
  }

  const a = result.agent;
  const fields = formatFields([
    ['ID', a.id],
    ['이름', a.name],
    ['유형', a.type],
    ['프로젝트', a.projectId],
    ['스킬', a.skill],
    ['상태', a.status],
    ['재시도', `${a.retryCount}/${MAX_RETRY_COUNT}`],
    ['생성일시', formatTimestamp(a.createdAt)],
    ['수정일시', formatTimestamp(a.updatedAt)],
  ]);

  const tasksBlock =
    a.tasks.length === 0
      ? `  Task: 없음\n  cm task create --agent ${a.id}`
      : indent(
          renderTable(
            ['ID', '제목', '상태', '생성일시'],
            a.tasks.map((t) => [
              shortId(t.id),
              truncateName(t.title),
              t.status,
              formatTimestamp(t.createdAt),
            ]),
            [ID_SHORT_LEN, NAME_MAX_LEN, 10, 19],
          ),
        );

  const allowed = AGENT_TRANSITIONS[a.status] ?? [];
  const allowedLine =
    allowed.length > 0 ? `  허용 상태 전이: ${allowed.join(', ')}` : '  종료된 Agent입니다';

  deps.log(successBlock('Agent 상세', `${fields}\n\n${tasksBlock}\n\n${allowedLine}`));
  deps.setExitCode(0);
}

function indent(block: string): string {
  return block
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');
}

// ─────────────────────────────────────────────
// status --set (변경) — SCR-AG04
// ─────────────────────────────────────────────

export type AgentStatusChangeResult =
  | { ok: true; agent: Agent; from: string; to: string; cascade?: CascadeItem[] }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'invalid_transition'; message: string; allowed: string[] }
  | {
      ok: false;
      reason: 'parent_not_active';
      projectName: string;
      projectId: string;
      projectStatus: string;
    }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

async function fetchAgentDetailQuietly(
  client: CliApiClient,
  id: string,
): Promise<AgentDetail | null> {
  try {
    return (await client.get<{ data: AgentDetail }>(`/agents/${id}`)).data;
  } catch {
    return null;
  }
}

/**
 * PARENT_NOT_ACTIVE(EVT-AG04-2)는 프로젝트명·현재상태를 요구하지만 에러
 * 응답엔 없다 — 별도 조회로 채운다. `projectId`는 호출부(`runAgentStatusChange`)
 * 가 전이 전 상태를 조회할 때 이미 알아낸 값을 그대로 넘긴다 — Agent를
 * 두 번 조회하지 않는다(task.ts `describeParentAgent`와 같은 원칙).
 */
async function describeParentProject(
  client: CliApiClient,
  projectId: string,
): Promise<{ projectName: string; projectId: string; projectStatus: string }> {
  if (!projectId) return { projectName: '알 수 없음', projectId: '', projectStatus: '알 수 없음' };

  try {
    const project = await client.get<{ data: Project }>(`/projects/${projectId}`);
    return { projectName: project.data.name, projectId, projectStatus: project.data.status };
  } catch {
    return { projectName: projectId, projectId, projectStatus: '알 수 없음' };
  }
}

async function mapAgentStatusChangeError(
  err: unknown,
  client: CliApiClient,
  resolvedId: string,
  projectId: string,
): Promise<AgentStatusChangeResult> {
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.AGENT_NOT_FOUND)
      return { ok: false, reason: 'not_found', id: resolvedId };
    if (err.code === ErrorCode.INVALID_TRANSITION) {
      const allowed = (err.details?.allowedTransitions as string[] | undefined) ?? [];
      return { ok: false, reason: 'invalid_transition', message: err.message, allowed };
    }
    if (err.code === ErrorCode.PARENT_NOT_ACTIVE) {
      const parent = await describeParentProject(client, projectId);
      return { ok: false, reason: 'parent_not_active', ...parent };
    }
  }
  return mapCommonApiError(err, client);
}

export async function runAgentStatusChange(opts: {
  client: CliApiClient;
  idOrPrefix: string;
  newStatus: string;
}): Promise<AgentStatusChangeResult> {
  // REV-H-03 — resolveId 호출을 try로 감싼다 (파일 헤더 원칙 참조)
  let resolved: Awaited<ReturnType<typeof resolveId<Agent>>>;
  try {
    resolved = await resolveId<Agent>(opts.client, '/agents', opts.idOrPrefix, (a) => a.name);
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
  if (!resolved.ok) return toIdLookupFailure(resolved, opts.idOrPrefix);

  // "이전상태 → 이후상태"(SCR-AG04)를 보여주려면 전이 전 상태가 필요하다 —
  // PATCH 응답은 이후 상태만 준다. 항상 조회해 둔다(취소 여부와 무관). 이때
  // 얻은 projectId를 PARENT_NOT_ACTIVE 실패 시 재사용한다.
  const before = await fetchAgentDetailQuietly(opts.client, resolved.id);

  try {
    const res = await opts.client.patch<{ data: Agent }>(`/agents/${resolved.id}/status`, {
      status: opts.newStatus,
    });
    const agent = res.data;

    // (취소 시) 캐스케이드 Task 목록(SCR-AG04) — project.ts와 같은 스냅샷 diff 방식
    const after =
      before && opts.newStatus === AgentStatus.CANCELLED
        ? await fetchAgentDetailQuietly(opts.client, resolved.id)
        : null;
    const cascade =
      before && after ? diffCascade<Task>(before.tasks, after.tasks, (t) => t.title) : undefined;

    return { ok: true, agent, from: before?.status ?? '', to: agent.status, cascade };
  } catch (err) {
    return mapAgentStatusChangeError(err, opts.client, resolved.id, before?.projectId ?? '');
  }
}

function presentAgentStatusChange(result: AgentStatusChangeResult, deps: CommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'invalid_transition') {
      const hint =
        result.allowed.length > 0 ? `허용된 전이: ${result.allowed.join(', ')}` : undefined;
      deps.errorLog(hint ? `✗ ${result.message}\n  ${hint}` : `✗ ${result.message}`);
      deps.setExitCode(1);
      return;
    }
    if (result.reason === 'parent_not_active') {
      deps.errorLog(
        `✗ 프로젝트가 활성 상태가 아닙니다: ${result.projectName} (현재: ${result.projectStatus})\n  cm project status ${result.projectId} --set running`,
      );
      deps.setExitCode(1);
      return;
    }
    presentIdOrCommonFailure(result, deps, 'Agent', 'cm agent list');
    return;
  }

  const a = result.agent;
  const fields = formatFields([
    ['Agent명', a.name],
    ['ID', a.id],
    ['프로젝트', a.projectId],
    ['전이', `${result.from} → ${result.to}`],
    ['변경일시', formatTimestamp(a.updatedAt)],
  ]);
  const body =
    result.cascade && result.cascade.length > 0
      ? `${fields}\n\n${cascadeBlock(`캐스케이드: Task ${result.cascade.length}건`, result.cascade)}`
      : fields;

  deps.log(successBlock('상태 변경 완료', body));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// delete — SCR-AG05 · PRM-02 · PRM-03
// ─────────────────────────────────────────────

export type AgentDeleteResult =
  | {
      ok: true;
      agentName: string;
      agentId: string;
      deletedTaskCount: number;
      result: DeleteAgentResult;
    }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'not_interactive' }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

async function confirmAgentDelete(
  promptConfirm: (q: string) => Promise<string>,
  agentName: string,
  agentId: string,
  taskCount: number,
): Promise<'confirmed' | 'cancelled' | 'not_interactive'> {
  const question =
    taskCount > 0
      ? `⚠ ${agentName} (${agentId})를 삭제하면 소속 Task ${taskCount}건도 함께 삭제됩니다. 계속할까요? (y/N) `
      : `${agentName} (${agentId})를 삭제할까요? (y/N) `;

  try {
    const answer = await promptConfirm(question);
    return answer.trim().toLowerCase() === 'y' ? 'confirmed' : 'cancelled';
  } catch (err) {
    if (err instanceof Error && err.message === 'NOT_TTY') return 'not_interactive';
    return 'cancelled';
  }
}

type AgentDetailFetchResult =
  | { ok: true; detail: AgentDetail }
  | Exclude<AgentDeleteResult, { ok: true }>;

async function fetchAgentDetailForDelete(
  client: CliApiClient,
  resolvedId: string,
  idOrPrefix: string,
): Promise<AgentDetailFetchResult> {
  try {
    const detail = (await client.get<{ data: AgentDetail }>(`/agents/${resolvedId}`)).data;
    return { ok: true, detail };
  } catch (err) {
    if (err instanceof ServerUnreachableError) {
      return { ok: false, reason: 'server_unreachable', serverUrl: client.baseUrl };
    }
    if (err instanceof ApiRequestError && err.code === ErrorCode.AGENT_NOT_FOUND) {
      return { ok: false, reason: 'not_found', id: idOrPrefix };
    }
    throw err;
  }
}

function mapAgentDeleteError(
  err: unknown,
  client: CliApiClient,
  idOrPrefix: string,
): AgentDeleteResult {
  if (err instanceof ApiRequestError && err.code === ErrorCode.AGENT_NOT_FOUND) {
    return { ok: false, reason: 'not_found', id: idOrPrefix };
  }
  return mapCommonApiError(err, client);
}

export async function runAgentDelete(opts: {
  client: CliApiClient;
  idOrPrefix: string;
  force: boolean;
  promptConfirm: (q: string) => Promise<string>;
}): Promise<AgentDeleteResult> {
  // REV-H-03 — resolveId 호출을 try로 감싼다 (파일 헤더 원칙 참조)
  let resolved: Awaited<ReturnType<typeof resolveId<Agent>>>;
  try {
    resolved = await resolveId<Agent>(opts.client, '/agents', opts.idOrPrefix, (a) => a.name);
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
  if (!resolved.ok) return toIdLookupFailure(resolved, opts.idOrPrefix);

  const fetched = await fetchAgentDetailForDelete(opts.client, resolved.id, opts.idOrPrefix);
  if (!fetched.ok) return fetched;
  const { detail } = fetched;

  if (!opts.force) {
    const decision = await confirmAgentDelete(
      opts.promptConfirm,
      detail.name,
      detail.id,
      detail.tasks.length,
    );
    if (decision === 'not_interactive') return { ok: false, reason: 'not_interactive' };
    if (decision === 'cancelled') return { ok: false, reason: 'cancelled' };
  }

  try {
    const res = await opts.client.delete<{ data: DeleteAgentResult }>(`/agents/${resolved.id}`);
    return {
      ok: true,
      agentName: detail.name,
      agentId: detail.id,
      deletedTaskCount: detail.tasks.length,
      result: res.data,
    };
  } catch (err) {
    return mapAgentDeleteError(err, opts.client, opts.idOrPrefix);
  }
}

function presentAgentDelete(result: AgentDeleteResult, deps: CommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'cancelled') {
      deps.errorLog('✗ 삭제가 취소되었습니다');
      deps.setExitCode(1);
      return;
    }
    if (result.reason === 'not_interactive') {
      deps.errorLog('✗ 대화형 터미널이 아닙니다\n  --force 옵션으로 확인을 생략할 수 있습니다');
      deps.setExitCode(1);
      return;
    }
    presentIdOrCommonFailure(result, deps, 'Agent', 'cm agent list');
    return;
  }

  // 대화 보존(D-27)·승인 자동 마감(R-04) — 개발 지시 §3(3): "삭제가 무엇을
  // 남기고 무엇을 닫았는지 출력하라"
  deps.log(
    successBlock(
      'Agent 삭제 완료',
      formatFields([
        ['Agent명', result.agentName],
        ['ID', result.agentId],
        ['삭제된 Task', `${result.deletedTaskCount}건`],
        [
          '보관된 대화',
          result.result.archivedConversationId
            ? shortId(result.result.archivedConversationId)
            : '없음',
        ],
        ['마감된 승인', `${result.result.closedApprovalCount}건`],
      ]),
    ),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// 공통 실패 표시
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

export function registerAgentCommand(
  program: Command,
  overrides: Partial<AgentCommandDeps> = {},
): void {
  const deps: AgentCommandDeps = { ...defaultAgentCommandDeps(), ...overrides };
  const agent = program.command('agent').description('Agent 관리');

  agent
    .command('create')
    .description('Agent를 생성한다 (SCR-AG01)')
    .requiredOption('--project <projectId>', '소속 프로젝트 ID')
    .requiredOption('--name <name>', 'Agent 이름')
    .option('--type <type>', 'Agent 유형')
    .option('--skill <skill>', '담당 스킬')
    .action(async (opts: { project: string; name: string; type?: string; skill?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runAgentCreate({
        client: deps.createClient(),
        projectId: opts.project,
        name: opts.name,
        type: opts.type,
        skill: opts.skill,
      });
      presentAgentCreate(result, deps);
    });

  agent
    .command('list')
    .description('Agent 목록을 조회한다 (SCR-AG02)')
    .option('--project <projectId>', '프로젝트 필터')
    .option('--status <status>', `상태 필터 (${AGENT_STATUS_VALUES.join('|')})`)
    .option('--page <page>', '페이지 번호', '1')
    .action(async (opts: { project?: string; status?: string; page: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runAgentList({
        client: deps.createClient(),
        projectId: opts.project,
        status: opts.status,
        page: Number(opts.page),
      });
      presentAgentList(result, deps);
    });

  agent
    .command('status')
    .description('Agent 상세를 조회하거나 상태를 변경한다 (SCR-AG03·SCR-AG04)')
    .argument('<id>', 'Agent ID (전체 또는 앞 8자리)')
    .option('--set <status>', `변경할 상태 (${AGENT_STATUS_VALUES.join('|')})`)
    .action(async (id: string, opts: { set?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const client = deps.createClient();

      if (opts.set) {
        const result = await runAgentStatusChange({ client, idOrPrefix: id, newStatus: opts.set });
        presentAgentStatusChange(result, deps);
        return;
      }

      const result = await runAgentDetail({ client, idOrPrefix: id });
      presentAgentDetail(result, deps);
    });

  agent
    .command('delete')
    .description('Agent를 삭제한다 (SCR-AG05)')
    .argument('<id>', 'Agent ID (전체 또는 앞 8자리)')
    .option('--force', '확인 프롬프트 없이 삭제', false)
    .action(async (id: string, opts: { force: boolean }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runAgentDelete({
        client: deps.createClient(),
        idOrPrefix: id,
        force: opts.force,
        promptConfirm: deps.promptConfirm,
      });
      presentAgentDelete(result, deps);
    });
}
