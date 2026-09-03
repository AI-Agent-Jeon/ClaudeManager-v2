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

  it('D-4 — --agent 접두어가 여러 Agent와 겹치면 ambiguous_agent', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [
          { id: 'a1a1a1a1-0000-0000-0000-000000000001', name: 'A' },
          { id: 'a1a1a1a2-0000-0000-0000-000000000002', name: 'B' },
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
      post: vi.fn(),
    });

    const result = await runTaskCreate({ client, agentId: 'a1a1a1a', title: 'X' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('ambiguous_agent');
    expect(client.post).not.toHaveBeenCalled();
  });

  it('D-4 — VALIDATION_ERROR면 message를 보존한 validation을 돌려준다', async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockRejectedValue(
          new ApiRequestError(400, ErrorCode.VALIDATION_ERROR, '제목은 필수입니다'),
        ),
    });

    const result = await runTaskCreate({ client, agentId: AGENT_A.id, title: '' });

    expect(result).toEqual({ ok: false, reason: 'validation', message: '제목은 필수입니다' });
  });

  it('프로젝트/Agent 이름 조회가 실패해도 생성 성공은 무효화하지 않는다 — ID로 대체', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ data: TASK_A }),
      get: vi.fn().mockRejectedValue(new Error('network blip')),
    });

    const result = await runTaskCreate({ client, agentId: AGENT_A.id, title: 'Task A' });

    expect(result).toEqual({ ok: true, task: TASK_A, agentName: TASK_A.agentId });
  });

  it('D-4 — POST가 서버 unreachable이면 mapCommonApiError로 위임한다', async () => {
    const client = fakeClient({
      post: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });

    const result = await runTaskCreate({ client, agentId: AGENT_A.id, title: 'X' });

    expect(result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      serverUrl: 'http://127.0.0.1:3000/api',
    });
  });

  it(
    'D-4/REV-H-03 — Agent ID 접두어 해석(resolveId) 중 서버가 끊기면 uncaught로 전파되지 않고 ' +
      'server_unreachable로 매핑된다',
    async () => {
      const client = fakeClient({
        get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
      });

      const result = await runTaskCreate({ client, agentId: AGENT_A.id.slice(0, 8), title: 'X' });

      expect(result).toEqual({
        ok: false,
        reason: 'server_unreachable',
        serverUrl: 'http://127.0.0.1:3000/api',
      });
    },
  );
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

  it('D-4 — --agent 접두어가 일치하지 않으면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
      }),
    });

    const result = await runTaskList({ client, agentId: 'zzzzzzzz', page: 1 });

    expect(result).toEqual({ ok: false, reason: 'not_found', id: 'zzzzzzzz' });
  });

  it('D-4 — 서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });

    const result = await runTaskList({ client, page: 1 });

    expect(result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      serverUrl: 'http://127.0.0.1:3000/api',
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

  it('D-4 — 없는 Task면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: null }),
      patch: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.TASK_NOT_FOUND, '없음')),
    });

    const result = await runTaskStatusChange({
      client,
      idOrPrefix: TASK_A.id,
      newStatus: 'in_progress',
    });

    expect(result).toEqual({ ok: false, reason: 'not_found', id: TASK_A.id });
  });

  it('D-4 — PATCH가 UNAUTHORIZED면 mapCommonApiError로 unauthenticated를 돌려준다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: null }),
      patch: vi
        .fn()
        .mockRejectedValue(new ApiRequestError(401, ErrorCode.UNAUTHORIZED, '인증 필요')),
    });

    const result = await runTaskStatusChange({
      client,
      idOrPrefix: TASK_A.id,
      newStatus: 'in_progress',
    });

    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
  });

  it(
    'D-4/REV-H-03 — ID 접두어 해석(resolveId) 중 서버가 끊기면 uncaught로 전파되지 않고 ' +
      'server_unreachable로 매핑된다',
    async () => {
      const client = fakeClient({
        get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
      });

      const result = await runTaskStatusChange({
        client,
        idOrPrefix: TASK_A.id.slice(0, 8),
        newStatus: 'in_progress',
      });

      expect(result).toEqual({
        ok: false,
        reason: 'server_unreachable',
        serverUrl: 'http://127.0.0.1:3000/api',
      });
    },
  );
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

  // D-4 커버리지 보강 — presentTaskCreate/List/Detail/StatusChange 각 실패
  // 분기는 run* 유닛 테스트가 아니라 실제 렌더링을 통해서만 히트한다.
  it('생성 — 없는 Agent면 exit 1, notFoundBlock을 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
      }),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'create', '--agent', 'zzzzzzzz', '--title', 'X'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('찾을 수 없습니다');
  });

  it('생성 — --agent 접두어가 겹치면 exit 1, 후보 목록을 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [
          { id: 'a1a1a1a1-0000-0000-0000-000000000001', name: 'A' },
          { id: 'a1a1a1a2-0000-0000-0000-000000000002', name: 'B' },
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'create', '--agent', 'a1a1a1a', '--title', 'X'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('여러 건과 일치합니다');
  });

  it('생성 — VALIDATION_ERROR면 exit 1, 서버 메시지를 출력한다', async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockRejectedValue(
          new ApiRequestError(400, ErrorCode.VALIDATION_ERROR, '제목은 필수입니다'),
        ),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'create', '--agent', AGENT_A.id, '--title', ''], {
      from: 'user',
    });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('제목은 필수입니다');
  });

  it('생성 — 서버 unreachable이면 exit 1, 안내 문구를 출력한다', async () => {
    const client = fakeClient({
      post: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'create', '--agent', AGENT_A.id, '--title', 'X'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('서버에 연결할 수 없습니다');
  });

  it('목록 — 항목이 있으면 표와 필터 푸터를 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [TASK_A],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['task', 'list', '--status', 'ready'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain(TASK_A.title);
    expect(out).toContain('filtered by: ready');
  });

  it('목록 — --agent 접두어가 일치하지 않으면 exit 1, notFoundBlock을 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
      }),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'list', '--agent', 'zzzzzzzz'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('찾을 수 없습니다');
  });

  it('상세 — 성공하면 허용 상태 전이를 출력한다', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: TASK_A }) });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['task', 'status', TASK_A.id], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('허용 상태 전이');
  });

  it('상세 — 종료 상태면 "종료된 Task입니다"를 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: { ...TASK_A, status: 'completed' } }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['task', 'status', TASK_A.id], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('종료된 Task입니다');
  });

  it('상세 — 없는 Task면 exit 1, notFoundBlock을 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.TASK_NOT_FOUND, '없음')),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'status', TASK_A.id], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('찾을 수 없습니다');
  });

  it('상태 변경 — 성공하면 전이 필드를 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: TASK_A }),
      patch: vi.fn().mockResolvedValue({ data: { ...TASK_A, status: 'in_progress' } }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['task', 'status', TASK_A.id, '--set', 'in_progress'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('ready → in_progress');
  });

  it('상태 변경 — invalid_transition이면 exit 1, 허용된 전이를 함께 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: TASK_A }),
      patch: vi.fn().mockRejectedValue(
        new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '전이 불가', {
          allowedTransitions: ['in_progress'],
        }),
      ),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'status', TASK_A.id, '--set', 'completed'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('허용된 전이: in_progress');
  });

  it('상태 변경 — parent_not_active면 exit 1, Agent 안내를 출력한다', async () => {
    const client = fakeClient({
      get: vi
        .fn()
        .mockResolvedValueOnce({ data: TASK_A })
        .mockResolvedValueOnce({ data: { ...AGENT_A, status: 'paused' } }),
      patch: vi
        .fn()
        .mockRejectedValue(new ApiRequestError(422, ErrorCode.PARENT_NOT_ACTIVE, '비활성')),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['task', 'status', TASK_A.id, '--set', 'in_progress'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('cm agent status');
  });
});
