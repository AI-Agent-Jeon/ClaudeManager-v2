import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, ServerUnreachableError } from '../../../../src/cli/api-client.js';
import { createProgram } from '../../../../src/cli/commands/auth.js';
import {
  registerTaskCommand,
  runTaskCreate,
  runTaskDetail,
  runTaskList,
  runTaskStatusChange,
} from '../../../../src/cli/commands/task.js';
import { saveAuth } from '../../../../src/cli/config.js';
import type { CliApiClient, CommandDeps } from '../../../../src/cli/runtime.js';
import { ErrorCode } from '../../../../src/shared/constants.js';

/**
 * `cm task create/list/status` — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-T01~T04 · §4-4 EVT-T01~T04
 */

function fakeClient(overrides: Partial<CliApiClient> = {}): CliApiClient {
  return {
    baseUrl: 'http://127.0.0.1:3000/api',
    get: vi.fn().mockRejectedValue(new Error('not stubbed')),
    post: vi.fn().mockRejectedValue(new Error('not stubbed')),
    patch: vi.fn().mockRejectedValue(new Error('not stubbed')),
    delete: vi.fn().mockRejectedValue(new Error('not stubbed')),
    ...overrides,
  };
}

const AGENT_A = {
  id: 'ag111111-e5f6-7890-abcd-ef1234567890',
  projectId: 'p1',
  name: 'Agent A',
  type: '',
  status: 'running',
  skill: '',
  config: {},
  retryCount: 0,
  createdAt: '',
  updatedAt: '',
};

const TASK_A = {
  id: 't1111111-e5f6-7890-abcd-ef1234567890',
  agentId: AGENT_A.id,
  title: 'Task A',
  description: '',
  status: 'ready',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('runTaskCreate', () => {
  it('성공하면 Task를 돌려주고 Agent 이름을 추가로 조회한다 (§3 SCR-T01 "이름+ID")', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ data: TASK_A }),
      get: vi.fn().mockResolvedValue({ data: AGENT_A }),
    });

    const result = await runTaskCreate({ client, agentId: AGENT_A.id, title: 'Task A' });

    expect(result).toEqual({ ok: true, task: TASK_A, agentName: AGENT_A.name });
  });

  it('전체 UUID인데 POST가 404를 돌려주면 agent_not_found', async () => {
    // 36자 전체 UUID는 resolveId가 목록 조회 없이 그대로 통과시킨다(runtime.ts FULL_ID_LEN)
    const fullId = 'missing1-e5f6-7890-abcd-ef1234567890';
    const client = fakeClient({
      post: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.AGENT_NOT_FOUND, '없음')),
    });

    const result = await runTaskCreate({ client, agentId: fullId, title: 'X' });

    expect(result).toEqual({ ok: false, reason: 'agent_not_found', agentId: fullId });
  });

  it('8자 접두어가 어떤 Agent와도 일치하지 않으면 agent_not_found (§8 ID 축약 규칙)', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
      }),
      post: vi.fn(),
    });

    const result = await runTaskCreate({ client, agentId: 'zzzzzzzz', title: 'X' });

    expect(result).toEqual({ ok: false, reason: 'agent_not_found', agentId: 'zzzzzzzz' });
    expect(client.post).not.toHaveBeenCalled();
  });
});

describe('runTaskList', () => {
  it('목록 + 필터를 돌려준다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [TASK_A],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    });

    const result = await runTaskList({ client, agentId: AGENT_A.id, page: 1 });

    expect(result).toEqual({
      ok: true,
      items: [TASK_A],
      page: 1,
      totalPages: 1,
      total: 1,
      status: undefined,
      agentId: AGENT_A.id,
    });
  });
});

describe('runTaskDetail', () => {
  it('상세를 돌려준다', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: TASK_A }) });

    const result = await runTaskDetail({ client, idOrPrefix: TASK_A.id });

    expect(result).toEqual({ ok: true, task: TASK_A });
  });

  it('없는 ID면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.TASK_NOT_FOUND, '없음')),
    });

    const result = await runTaskDetail({ client, idOrPrefix: TASK_A.id });

    expect(result).toEqual({ ok: false, reason: 'not_found', id: TASK_A.id });
  });

  it(
    'REV-H-03 — ID 접두어 해석(resolveId) 중 서버가 끊기면 uncaught로 전파되지 않고 ' +
      'server_unreachable로 매핑된다',
    async () => {
      const client = fakeClient({
        get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
      });

      const result = await runTaskDetail({ client, idOrPrefix: TASK_A.id.slice(0, 8) });

      expect(result).toEqual({
        ok: false,
        reason: 'server_unreachable',
        serverUrl: 'http://127.0.0.1:3000/api',
      });
    },
  );
});

describe('runTaskStatusChange', () => {
  it('성공하면 이전상태 → 이후상태를 돌려준다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: TASK_A }),
      patch: vi.fn().mockResolvedValue({ data: { ...TASK_A, status: 'in_progress' } }),
    });

    const result = await runTaskStatusChange({
      client,
      idOrPrefix: TASK_A.id,
      newStatus: 'in_progress',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.from).toBe('ready');
    expect(result.to).toBe('in_progress');
  });

  it('상위 Agent가 비활성이면 Agent명·현재상태를 채운다 (EVT-T04-2)', async () => {
    const client = fakeClient({
      patch: vi
        .fn()
        .mockRejectedValue(new ApiRequestError(422, ErrorCode.PARENT_NOT_ACTIVE, 'Agent 비활성')),
      get: vi
        .fn()
        .mockResolvedValueOnce({ data: TASK_A })
        .mockResolvedValueOnce({ data: { ...AGENT_A, status: 'paused' } }),
    });

    const result = await runTaskStatusChange({
      client,
      idOrPrefix: TASK_A.id,
      newStatus: 'in_progress',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'parent_not_active',
      agentName: AGENT_A.name,
      agentId: AGENT_A.id,
      agentStatus: 'paused',
    });
  });

  it('허용되지 않는 전이면 allowedTransitions를 보존한다 (DEV-D-04)', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: TASK_A }),
      patch: vi.fn().mockRejectedValue(
        new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '전이 불가', {
          allowedTransitions: ['in_progress', 'skipped', 'cancelled'],
        }),
      ),
    });

    const result = await runTaskStatusChange({
      client,
      idOrPrefix: TASK_A.id,
      newStatus: 'completed',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_transition',
      message: '전이 불가',
      allowed: ['in_progress', 'skipped', 'cancelled'],
    });
  });

  it('서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: TASK_A }),
      patch: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });

    const result = await runTaskStatusChange({
      client,
      idOrPrefix: TASK_A.id,
      newStatus: 'in_progress',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('server_unreachable');
  });
});

describe('registerTaskCommand — 출력·종료 코드', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-task-test-'));
    saveAuth({ token: 't', expiresAt: '2099-01-01T00:00:00.000Z' }, homeDir);
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  function buildTestProgram(client: CliApiClient) {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | undefined;

    const program = createProgram();
    program.exitOverride();
    const deps: Partial<CommandDeps> = {
      createClient: () => client,
      homeDir,
      log: (msg) => logs.push(msg),
      errorLog: (msg) => errors.push(msg),
      setExitCode: (code) => {
        exitCode = code;
      },
    };
    registerTaskCommand(program, deps);

    return { program, logs, errors, getExitCode: () => exitCode };
  }

  it('생성 성공 시 exit 0', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ data: TASK_A }),
      get: vi.fn().mockResolvedValue({ data: AGENT_A }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['task', 'create', '--agent', AGENT_A.id, '--title', 'Task A'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain(TASK_A.id);
  });

  it('목록이 비어 있으면 안내 문구 + exit 0', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('Task가 없습니다');
  });

  it('인증되지 않았으면 exit 1', async () => {
    rmSync(homeDir, { recursive: true, force: true });
    homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-task-noauth-'));
    const client = fakeClient();
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'list'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('cm auth login');
  });

  it('task 하위에 create·list·status가 등록된다', () => {
    const { program } = buildTestProgram(fakeClient());
    const task = program.commands.find((c) => c.name() === 'task');
    const subNames = task?.commands.map((c) => c.name());
    expect(subNames).toEqual(expect.arrayContaining(['create', 'list', 'status']));
  });
});
