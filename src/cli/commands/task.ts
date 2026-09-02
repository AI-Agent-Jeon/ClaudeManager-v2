import type { Command } from 'commander';
import { ErrorCode, TaskStatus } from '../../shared/constants.js';
import { TASK_TRANSITIONS } from '../../shared/state-transitions.js';
import type { Agent, Task } from '../../shared/types.js';
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
  type CliApiClient,
  type CommandDeps,
  checkAuth,
  defaultCommandDeps,
  notFoundBlock,
  presentAuthGuardFailure,
  resolveId,
  serverUnreachableBlock,
  toIdLookupFailure,
  unauthenticatedBlock,
} from '../runtime.js';

/**
 * `cm task create/list/status` — SCR-T01~T04
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-T01~T04 · §3 표시 데이터 · §4-4 EVT-T01~T04
 *
 * `commands/project.ts`·`commands/agent.ts`와 같은 관용구다. Task는 캐스케이드
 * 대상이 아니고(하위 엔티티가 없다) 삭제 명령도 없어 셋 중 가장 단순하다.
 * `cm agent create`처럼 생성 결과가 "소속 Agent(이름+ID)"를 요구해(§3
 * SCR-T01), POST 성공 뒤 Agent 이름을 한 번 더 조회한다.
 */

const TASK_STATUS_VALUES = Object.values(TaskStatus);

// ─────────────────────────────────────────────
// create — SCR-T01
// ─────────────────────────────────────────────

export type TaskCreateResult =
  | { ok: true; task: Task; agentName: string }
  | { ok: false; reason: 'agent_not_found'; agentId: string }
  | { ok: false; reason: 'ambiguous_agent'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'validation'; message: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

function mapTaskCreateError(err: unknown, client: CliApiClient, agentId: string): TaskCreateResult {
  if (err instanceof ServerUnreachableError) {
    return { ok: false, reason: 'server_unreachable', serverUrl: client.baseUrl };
  }
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.AGENT_NOT_FOUND)
      return { ok: false, reason: 'agent_not_found', agentId };
    if (err.code === ErrorCode.VALIDATION_ERROR)
      return { ok: false, reason: 'validation', message: err.message };
    if (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED) {
      return { ok: false, reason: 'unauthenticated' };
    }
  }
  throw err;
}

export async function runTaskCreate(opts: {
  client: CliApiClient;
  agentId: string;
  title: string;
  description?: string;
}): Promise<TaskCreateResult> {
  // `--agent`도 §8 ID 축약 규칙 대상이다 — 접두어를 그대로 POST에 실으면
  // 백엔드가 정확히 일치하는 UUID만 찾아 항상 AGENT_NOT_FOUND가 난다
  // (runAgentCreate의 `--project`와 같은 함정).
  const resolvedAgent = await resolveId<Agent>(opts.client, '/agents', opts.agentId, (a) => a.name);
  if (!resolvedAgent.ok) {
    if (resolvedAgent.reason === 'not_found') {
      return { ok: false, reason: 'agent_not_found', agentId: opts.agentId };
    }
    return { ok: false, reason: 'ambiguous_agent', candidates: resolvedAgent.candidates };
  }
  const agentId = resolvedAgent.id;

  try {
    const res = await opts.client.post<{ data: Task }>('/tasks', {
      agentId,
      title: opts.title,
      description: opts.description,
    });
    const task = res.data;

    // "소속 Agent(이름+ID)"(§3 SCR-T01) — Task 응답엔 agentId뿐이라 이름을
    // 보여주려면 한 번 더 조회한다. 실패해도 생성 자체는 성공했으니 ID로 대체한다.
    let agentName = task.agentId;
    try {
      const agent = await opts.client.get<{ data: Agent }>(`/agents/${task.agentId}`);
      agentName = agent.data.name;
    } catch {
      agentName = task.agentId;
    }

    return { ok: true, task, agentName };
  } catch (err) {
    return mapTaskCreateError(err, opts.client, agentId);
  }
}

function presentTaskCreate(result: TaskCreateResult, deps: CommandDeps): void {
  if (result.ok) {
    const t = result.task;
    deps.log(
      successBlock(
        'Task 생성 완료',
        formatFields([
          ['ID', t.id],
          ['제목', t.title],
          ['Agent', `${result.agentName} (${t.agentId})`],
          ['상태', t.status],
          ['설명', t.description],
          ['생성일시', formatTimestamp(t.createdAt)],
        ]),
      ),
    );
    deps.setExitCode(0);
    return;
  }

  switch (result.reason) {
    case 'agent_not_found':
      deps.errorLog(notFoundBlock('Agent', result.agentId, 'cm agent list'));
      break;
    case 'ambiguous_agent':
      deps.errorLog(ambiguousIdBlock(result.candidates));
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
// list — SCR-T02
// ─────────────────────────────────────────────

export type TaskListResult =
  | {
      ok: true;
      items: Task[];
      page: number;
      totalPages: number;
      total: number;
      status?: string;
      agentId?: string;
    }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runTaskList(opts: {
  client: CliApiClient;
  agentId?: string;
  status?: string;
  page: number;
}): Promise<TaskListResult> {
  // --agent도 §8 ID 축약 규칙 대상이다 — runAgentList의 --project와 같은 이유
  let agentId = opts.agentId;
  if (agentId) {
    const resolved = await resolveId<Agent>(opts.client, '/agents', agentId, (a) => a.name);
    if (!resolved.ok) return toIdLookupFailure(resolved, agentId);
    agentId = resolved.id;
  }

  try {
    const qs = new URLSearchParams({ page: String(opts.page) });
    if (opts.status) qs.set('status', opts.status);
    if (agentId) qs.set('agentId', agentId);
    const res = await opts.client.get<{
      data: Task[];
      pagination: { page: number; totalPages: number; total: number };
    }>(`/tasks?${qs.toString()}`);
    return {
      ok: true,
      items: res.data,
      page: res.pagination.page,
      totalPages: res.pagination.totalPages,
      total: res.pagination.total,
      status: opts.status,
      agentId,
    };
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

function presentTaskList(result: TaskListResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentIdOrCommonFailure(result, deps, 'Agent', 'cm agent list');
    return;
  }

  if (result.items.length === 0) {
    deps.log(`${successBlock('Task 목록', 'Task가 없습니다')}\n\n  cm task create --agent <id>`);
    deps.setExitCode(0);
    return;
  }

  const rows = result.items.map((t) => [
    shortId(t.id),
    truncateName(t.title),
    t.status,
    formatTimestamp(t.createdAt),
  ]);
  const table = renderTable(['ID', '제목', '상태', '생성일시'], rows, [
    ID_SHORT_LEN,
    NAME_MAX_LEN,
    10,
    19,
  ]);
  const filters = [result.status, result.agentId].filter((v): v is string => Boolean(v));
  const footer = paginationFooter(
    { page: result.page, pageSize: 0, total: result.total, totalPages: result.totalPages },
    filters,
  );
  deps.log(successBlock('Task 목록', `${table}\n\n${footer}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// status (조회) — SCR-T03
// ─────────────────────────────────────────────

export type TaskDetailResult =
  | { ok: true; task: Task }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runTaskDetail(opts: {
  client: CliApiClient;
  idOrPrefix: string;
}): Promise<TaskDetailResult> {
  const resolved = await resolveId<Task>(opts.client, '/tasks', opts.idOrPrefix, (t) => t.title);
  if (!resolved.ok) return toIdLookupFailure(resolved, opts.idOrPrefix);

  try {
    const res = await opts.client.get<{ data: Task }>(`/tasks/${resolved.id}`);
    return { ok: true, task: res.data };
  } catch (err) {
    if (err instanceof ServerUnreachableError) {
      return { ok: false, reason: 'server_unreachable', serverUrl: opts.client.baseUrl };
    }
    if (err instanceof ApiRequestError) {
      if (err.code === ErrorCode.TASK_NOT_FOUND)
        return { ok: false, reason: 'not_found', id: opts.idOrPrefix };
      if (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED) {
        return { ok: false, reason: 'unauthenticated' };
      }
    }
    throw err;
  }
}

function presentTaskDetail(result: TaskDetailResult, deps: CommandDeps): void {
  if (!result.ok) {
    presentIdOrCommonFailure(result, deps, 'Task', 'cm task list');
    return;
  }

  const t = result.task;
  const fields = formatFields([
    ['ID', t.id],
    ['제목', t.title],
    ['Agent', t.agentId],
    ['상태', t.status],
    ['설명', t.description],
    ['생성일시', formatTimestamp(t.createdAt)],
    ['수정일시', formatTimestamp(t.updatedAt)],
  ]);

  const allowed = TASK_TRANSITIONS[t.status] ?? [];
  const allowedLine =
    allowed.length > 0 ? `  허용 상태 전이: ${allowed.join(', ')}` : '  종료된 Task입니다';

  deps.log(successBlock('Task 상세', `${fields}\n\n${allowedLine}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// status --set (변경) — SCR-T04
// ─────────────────────────────────────────────

export type TaskStatusChangeResult =
  | { ok: true; task: Task; from: string; to: string }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'invalid_transition'; message: string; allowed: string[] }
  | {
      ok: false;
      reason: 'parent_not_active';
      agentName: string;
      agentId: string;
      agentStatus: string;
    }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

/**
 * PARENT_NOT_ACTIVE(EVT-T04-2)는 Agent명·현재상태를 요구하지만 에러 응답엔
 * 없다 — 별도 조회로 채운다. `agentId`는 호출부(`runTaskStatusChange`)가
 * 전이 전 상태를 조회할 때 이미 알아낸 값을 그대로 넘긴다 — Task를
 * 두 번 조회하지 않는다.
 */
async function describeParentAgent(
  client: CliApiClient,
  agentId: string,
): Promise<{ agentName: string; agentId: string; agentStatus: string }> {
  if (!agentId) return { agentName: '알 수 없음', agentId: '', agentStatus: '알 수 없음' };

  try {
    const agent = await client.get<{ data: Agent }>(`/agents/${agentId}`);
    return { agentName: agent.data.name, agentId, agentStatus: agent.data.status };
  } catch {
    return { agentName: agentId, agentId, agentStatus: '알 수 없음' };
  }
}

async function mapTaskStatusChangeError(
  err: unknown,
  client: CliApiClient,
  resolvedId: string,
  agentId: string,
): Promise<TaskStatusChangeResult> {
  if (err instanceof ServerUnreachableError) {
    return { ok: false, reason: 'server_unreachable', serverUrl: client.baseUrl };
  }
  if (err instanceof ApiRequestError) {
    if (err.code === ErrorCode.TASK_NOT_FOUND)
      return { ok: false, reason: 'not_found', id: resolvedId };
    if (err.code === ErrorCode.INVALID_TRANSITION) {
      const allowed = (err.details?.allowedTransitions as string[] | undefined) ?? [];
      return { ok: false, reason: 'invalid_transition', message: err.message, allowed };
    }
    if (err.code === ErrorCode.PARENT_NOT_ACTIVE) {
      const parent = await describeParentAgent(client, agentId);
      return { ok: false, reason: 'parent_not_active', ...parent };
    }
    if (err.code === ErrorCode.UNAUTHORIZED || err.code === ErrorCode.AUTH_TOKEN_EXPIRED) {
      return { ok: false, reason: 'unauthenticated' };
    }
  }
  throw err;
}

export async function runTaskStatusChange(opts: {
  client: CliApiClient;
  idOrPrefix: string;
  newStatus: string;
}): Promise<TaskStatusChangeResult> {
  const resolved = await resolveId<Task>(opts.client, '/tasks', opts.idOrPrefix, (t) => t.title);
  if (!resolved.ok) return toIdLookupFailure(resolved, opts.idOrPrefix);

  // 전이 전 상태(from)와 소속 Agent ID를 함께 확보한다 — PATCH 응답은 이후
  // 상태만 주고(SCR-T04 "이전상태 → 이후상태"), PARENT_NOT_ACTIVE 실패 시
  // Agent를 다시 조회하려면 agentId가 필요하다(EVT-T04-2).
  let fromStatus = '';
  let agentId = '';
  try {
    const task = (await opts.client.get<{ data: Task }>(`/tasks/${resolved.id}`)).data;
    fromStatus = task.status;
    agentId = task.agentId;
  } catch {
    fromStatus = '';
  }

  try {
    const res = await opts.client.patch<{ data: Task }>(`/tasks/${resolved.id}/status`, {
      status: opts.newStatus,
    });
    const task = res.data;
    return { ok: true, task, from: fromStatus, to: task.status };
  } catch (err) {
    return mapTaskStatusChangeError(err, opts.client, resolved.id, agentId);
  }
}

function presentTaskStatusChange(result: TaskStatusChangeResult, deps: CommandDeps): void {
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
        `✗ Agent가 활성 상태가 아닙니다: ${result.agentName} (현재: ${result.agentStatus})\n  cm agent status ${result.agentId} --set running`,
      );
      deps.setExitCode(1);
      return;
    }
    presentIdOrCommonFailure(result, deps, 'Task', 'cm task list');
    return;
  }

  const t = result.task;
  deps.log(
    successBlock(
      '상태 변경 완료',
      formatFields([
        ['Task 제목', t.title],
        ['ID', t.id],
        ['Agent', t.agentId],
        ['전이', `${result.from} → ${result.to}`],
        ['변경일시', formatTimestamp(t.updatedAt)],
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

export function registerTaskCommand(program: Command, overrides: Partial<CommandDeps> = {}): void {
  const deps: CommandDeps = { ...defaultCommandDeps(), ...overrides };
  const task = program.command('task').description('Task 관리');

  task
    .command('create')
    .description('Task를 생성한다 (SCR-T01)')
    .requiredOption('--agent <agentId>', '소속 Agent ID')
    .requiredOption('--title <title>', 'Task 제목')
    .option('--description <description>', 'Task 설명')
    .action(async (opts: { agent: string; title: string; description?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runTaskCreate({
        client: deps.createClient(),
        agentId: opts.agent,
        title: opts.title,
        description: opts.description,
      });
      presentTaskCreate(result, deps);
    });

  task
    .command('list')
    .description('Task 목록을 조회한다 (SCR-T02)')
    .option('--agent <agentId>', 'Agent 필터')
    .option('--status <status>', `상태 필터 (${TASK_STATUS_VALUES.join('|')})`)
    .option('--page <page>', '페이지 번호', '1')
    .action(async (opts: { agent?: string; status?: string; page: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runTaskList({
        client: deps.createClient(),
        agentId: opts.agent,
        status: opts.status,
        page: Number(opts.page),
      });
      presentTaskList(result, deps);
    });

  task
    .command('status')
    .description('Task 상세를 조회하거나 상태를 변경한다 (SCR-T03·SCR-T04)')
    .argument('<id>', 'Task ID (전체 또는 앞 8자리)')
    .option('--set <status>', `변경할 상태 (${TASK_STATUS_VALUES.join('|')})`)
    .action(async (id: string, opts: { set?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const client = deps.createClient();

      if (opts.set) {
        const result = await runTaskStatusChange({ client, idOrPrefix: id, newStatus: opts.set });
        presentTaskStatusChange(result, deps);
        return;
      }

      const result = await runTaskDetail({ client, idOrPrefix: id });
      presentTaskDetail(result, deps);
    });
}
