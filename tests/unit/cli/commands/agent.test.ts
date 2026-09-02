import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, ServerUnreachableError } from '../../../../src/cli/api-client.js';
import {
  registerAgentCommand,
  runAgentCreate,
  runAgentDelete,
  runAgentDetail,
  runAgentList,
  runAgentStatusChange,
} from '../../../../src/cli/commands/agent.js';
import { createProgram } from '../../../../src/cli/commands/auth.js';
import { saveAuth } from '../../../../src/cli/config.js';
import type { CliApiClient, CommandDeps } from '../../../../src/cli/runtime.js';
import { ErrorCode } from '../../../../src/shared/constants.js';

/**
 * `cm agent create/list/status/delete` — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-AG01~AG05 · §4-3 EVT-AG01~AG05 · §5 PRM-02·03
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

const PROJECT_A = {
  id: 'p1111111-e5f6-7890-abcd-ef1234567890',
  name: '프로젝트A',
  description: '',
  status: 'running',
  createdAt: '',
  updatedAt: '',
};

const AGENT_A = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  projectId: PROJECT_A.id,
  name: 'Agent A',
  type: 'dev',
  status: 'created',
  skill: 'develop',
  config: {},
  retryCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('runAgentCreate', () => {
  it('성공하면 Agent를 돌려주고 프로젝트 이름을 추가로 조회한다 (§3 SCR-AG01 "이름+ID")', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ data: AGENT_A }),
      get: vi.fn().mockResolvedValue({ data: PROJECT_A }),
    });

    const result = await runAgentCreate({ client, projectId: PROJECT_A.id, name: 'Agent A' });

    expect(result).toEqual({ ok: true, agent: AGENT_A, projectName: PROJECT_A.name });
  });

  it('프로젝트 이름 조회가 실패해도 생성 성공은 무효화하지 않는다 — ID로 대체', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ data: AGENT_A }),
      get: vi.fn().mockRejectedValue(new Error('network blip')),
    });

    const result = await runAgentCreate({ client, projectId: PROJECT_A.id, name: 'Agent A' });

    expect(result).toEqual({ ok: true, agent: AGENT_A, projectName: PROJECT_A.id });
  });

  it('전체 UUID인데 POST가 404를 돌려주면 project_not_found', async () => {
    // 36자 전체 UUID는 resolveId가 목록 조회 없이 그대로 통과시키므로
    // (runtime.ts FULL_ID_LEN), POST가 직접 404를 낸다.
    const fullId = 'missing1-e5f6-7890-abcd-ef1234567890';
    const client = fakeClient({
      post: vi
        .fn()
        .mockRejectedValue(new ApiRequestError(404, ErrorCode.PROJECT_NOT_FOUND, '없음')),
    });

    const result = await runAgentCreate({ client, projectId: fullId, name: 'X' });

    expect(result).toEqual({ ok: false, reason: 'project_not_found', projectId: fullId });
  });

  it('8자 접두어가 어떤 프로젝트와도 일치하지 않으면 project_not_found (§8 ID 축약 규칙)', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
      }),
      post: vi.fn(),
    });

    const result = await runAgentCreate({ client, projectId: 'zzzzzzzz', name: 'X' });

    expect(result).toEqual({ ok: false, reason: 'project_not_found', projectId: 'zzzzzzzz' });
    expect(client.post).not.toHaveBeenCalled();
  });

  it('이름 중복이면 name_conflict', async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockRejectedValue(new ApiRequestError(409, ErrorCode.AGENT_NAME_CONFLICT, '중복')),
    });

    const result = await runAgentCreate({ client, projectId: PROJECT_A.id, name: '중복' });

    expect(result).toEqual({ ok: false, reason: 'name_conflict', name: '중복' });
  });

  it('--project 접두어가 여러 프로젝트와 겹치면 ambiguous_project', async () => {
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

    const result = await runAgentCreate({ client, projectId: 'a1a1a1a', name: 'X' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('ambiguous_project');
    expect(client.post).not.toHaveBeenCalled();
  });
});

describe('runAgentList', () => {
  it('목록 + 필터를 돌려준다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [AGENT_A],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    });

    const result = await runAgentList({ client, projectId: PROJECT_A.id, page: 1 });

    expect(result).toEqual({
      ok: true,
      items: [AGENT_A],
      page: 1,
      totalPages: 1,
      total: 1,
      status: undefined,
      projectId: PROJECT_A.id,
    });
  });

  it('--project가 8자 접두어면 전체 UUID로 확장해 쿼리에 싣는다 (§8 ID 축약 규칙)', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: [PROJECT_A],
        pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
      })
      .mockResolvedValueOnce({
        data: [AGENT_A],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    const client = fakeClient({ get });

    const result = await runAgentList({ client, projectId: PROJECT_A.id.slice(0, 8), page: 1 });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.projectId).toBe(PROJECT_A.id);
    expect(get).toHaveBeenLastCalledWith(expect.stringContaining(`projectId=${PROJECT_A.id}`));
  });

  it('서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });

    const result = await runAgentList({ client, page: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('server_unreachable');
  });
});

describe('runAgentDetail', () => {
  const Detail = { ...AGENT_A, tasks: [], waitingReason: null, conversationId: null };

  it('상세 + Task 목록을 돌려준다', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: Detail }) });

    const result = await runAgentDetail({ client, idOrPrefix: AGENT_A.id });

    expect(result).toEqual({ ok: true, agent: Detail });
  });

  it('없는 ID면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.AGENT_NOT_FOUND, '없음')),
    });

    const result = await runAgentDetail({ client, idOrPrefix: AGENT_A.id });

    expect(result).toEqual({ ok: false, reason: 'not_found', id: AGENT_A.id });
  });
});

describe('runAgentStatusChange', () => {
  it('취소 시 캐스케이드 Task 목록을 스냅샷 diff로 찾아낸다 (개발 지시 §3(2))', async () => {
    const before = {
      ...AGENT_A,
      status: 'running',
      tasks: [
        {
          id: 't-1',
          agentId: AGENT_A.id,
          title: 'Task 1',
          description: '',
          status: 'in_progress',
          createdAt: '',
          updatedAt: '',
        },
      ],
      waitingReason: null,
      conversationId: null,
    };
    const after = {
      ...before,
      status: 'cancelled',
      tasks: [{ ...before.tasks[0], status: 'cancelled' }],
    };
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: before })
      .mockResolvedValueOnce({ data: after });
    const client = fakeClient({
      get,
      patch: vi.fn().mockResolvedValue({ data: { ...AGENT_A, status: 'cancelled' } }),
    });

    const result = await runAgentStatusChange({
      client,
      idOrPrefix: AGENT_A.id,
      newStatus: 'cancelled',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.cascade).toEqual([
      { id: 't-1', label: 'Task 1', from: 'in_progress', to: 'cancelled' },
    ]);
  });

  it('상위 프로젝트가 비활성이면 프로젝트명·현재상태를 채워 parent_not_active를 돌려준다 (EVT-AG04-2)', async () => {
    const client = fakeClient({
      patch: vi
        .fn()
        .mockRejectedValue(
          new ApiRequestError(422, ErrorCode.PARENT_NOT_ACTIVE, '프로젝트 비활성'),
        ),
      // 2콜: ① from-status용 Agent 상세(runAgentStatusChange, projectId도 여기서 얻는다)
      // ② PARENT_NOT_ACTIVE 실패 시 그 projectId로 Project 조회(describeParentProject)
      get: vi
        .fn()
        .mockResolvedValueOnce({
          data: { ...AGENT_A, tasks: [], waitingReason: null, conversationId: null },
        })
        .mockResolvedValueOnce({ data: { ...PROJECT_A, status: 'paused' } }),
    });

    const result = await runAgentStatusChange({
      client,
      idOrPrefix: AGENT_A.id,
      newStatus: 'running',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'parent_not_active',
      projectName: PROJECT_A.name,
      projectId: PROJECT_A.id,
      projectStatus: 'paused',
    });
  });

  it('허용되지 않는 전이면 allowedTransitions를 보존한다', async () => {
    const client = fakeClient({
      patch: vi.fn().mockRejectedValue(
        new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '전이 불가', {
          allowedTransitions: ['running', 'cancelled'],
        }),
      ),
    });

    const result = await runAgentStatusChange({
      client,
      idOrPrefix: AGENT_A.id,
      newStatus: 'completed',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_transition',
      message: '전이 불가',
      allowed: ['running', 'cancelled'],
    });
  });
});

describe('runAgentDelete', () => {
  const DetailWithTasks = {
    ...AGENT_A,
    tasks: [
      {
        id: 't-1',
        agentId: AGENT_A.id,
        title: 'Task 1',
        description: '',
        status: 'ready',
        createdAt: '',
        updatedAt: '',
      },
    ],
    waitingReason: null,
    conversationId: null,
  };

  it('--force면 확인 프롬프트 없이 삭제하고 보관·마감 결과를 돌려준다 (D-27·R-04)', async () => {
    const promptConfirm = vi.fn();
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: DetailWithTasks }),
      delete: vi
        .fn()
        .mockResolvedValue({ data: { archivedConversationId: 'conv-1', closedApprovalCount: 2 } }),
    });

    const result = await runAgentDelete({
      client,
      idOrPrefix: AGENT_A.id,
      force: true,
      promptConfirm,
    });

    expect(result).toEqual({
      ok: true,
      agentName: AGENT_A.name,
      agentId: AGENT_A.id,
      deletedTaskCount: 1,
      result: { archivedConversationId: 'conv-1', closedApprovalCount: 2 },
    });
    expect(promptConfirm).not.toHaveBeenCalled();
  });

  it('확인 프롬프트에서 y를 답하면 삭제한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: DetailWithTasks }),
      delete: vi
        .fn()
        .mockResolvedValue({ data: { archivedConversationId: 'conv-1', closedApprovalCount: 0 } }),
    });

    const result = await runAgentDelete({
      client,
      idOrPrefix: AGENT_A.id,
      force: false,
      promptConfirm: vi.fn().mockResolvedValue('y'),
    });

    expect(result.ok).toBe(true);
  });

  it('확인 프롬프트에서 거부(기본값 N)하면 cancelled — API를 호출하지 않는다', async () => {
    const del = vi.fn();
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: DetailWithTasks }),
      delete: del,
    });

    const result = await runAgentDelete({
      client,
      idOrPrefix: AGENT_A.id,
      force: false,
      promptConfirm: vi.fn().mockResolvedValue(''),
    });

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(del).not.toHaveBeenCalled();
  });

  it('비대화형 환경(NOT_TTY)이면 not_interactive — --force 없이는 진행하지 않는다', async () => {
    const del = vi.fn();
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: DetailWithTasks }),
      delete: del,
    });

    const result = await runAgentDelete({
      client,
      idOrPrefix: AGENT_A.id,
      force: false,
      promptConfirm: vi.fn().mockRejectedValue(new Error('NOT_TTY')),
    });

    expect(result).toEqual({ ok: false, reason: 'not_interactive' });
    expect(del).not.toHaveBeenCalled();
  });

  it('없는 Agent면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.AGENT_NOT_FOUND, '없음')),
    });

    const result = await runAgentDelete({
      client,
      idOrPrefix: AGENT_A.id,
      force: true,
      promptConfirm: vi.fn(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_found', id: AGENT_A.id });
  });
});

describe('registerAgentCommand — 출력·종료 코드', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-agent-test-'));
    saveAuth({ token: 't', expiresAt: '2099-01-01T00:00:00.000Z' }, homeDir);
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  function buildTestProgram(client: CliApiClient, promptConfirm = vi.fn()) {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | undefined;

    const program = createProgram();
    program.exitOverride();
    const deps: Partial<CommandDeps> & { promptConfirm: typeof promptConfirm } = {
      createClient: () => client,
      homeDir,
      promptConfirm,
      log: (msg) => logs.push(msg),
      errorLog: (msg) => errors.push(msg),
      setExitCode: (code) => {
        exitCode = code;
      },
    };
    registerAgentCommand(program, deps);

    return { program, logs, errors, getExitCode: () => exitCode };
  }

  it('생성 성공 시 exit 0이고 소속 프로젝트(이름+ID)를 출력한다', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({ data: AGENT_A }),
      get: vi.fn().mockResolvedValue({ data: PROJECT_A }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['agent', 'create', '--project', PROJECT_A.id, '--name', 'Agent A'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain(PROJECT_A.name);
  });

  it('삭제 --force 성공 시 exit 0이고 보관된 대화·마감된 승인을 출력한다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: { ...AGENT_A, tasks: [], waitingReason: null, conversationId: null },
      }),
      delete: vi
        .fn()
        .mockResolvedValue({ data: { archivedConversationId: 'conv-1', closedApprovalCount: 3 } }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['agent', 'delete', AGENT_A.id, '--force'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('conv-1');
    expect(out).toContain('3건');
  });

  it('삭제 취소 시 exit 1', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: { ...AGENT_A, tasks: [], waitingReason: null, conversationId: null },
      }),
    });
    const { program, getExitCode, errors } = buildTestProgram(
      client,
      vi.fn().mockResolvedValue('n'),
    );

    await program.parseAsync(['agent', 'delete', AGENT_A.id], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('취소');
  });

  it('agent 하위에 create·list·status·delete가 등록된다', () => {
    const { program } = buildTestProgram(fakeClient());
    const agent = program.commands.find((c) => c.name() === 'agent');
    const subNames = agent?.commands.map((c) => c.name());
    expect(subNames).toEqual(expect.arrayContaining(['create', 'list', 'status', 'delete']));
  });
});
