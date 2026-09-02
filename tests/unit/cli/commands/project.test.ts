import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, ServerUnreachableError } from '../../../../src/cli/api-client.js';
import { createProgram } from '../../../../src/cli/commands/auth.js';
import {
  registerProjectCommand,
  runProjectCreate,
  runProjectDetail,
  runProjectList,
  runProjectStatusChange,
} from '../../../../src/cli/commands/project.js';
import { saveAuth } from '../../../../src/cli/config.js';
import type { CliApiClient, CommandDeps } from '../../../../src/cli/runtime.js';
import { ErrorCode } from '../../../../src/shared/constants.js';

/**
 * `cm project create/list/status` — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-P01~P04 · §4-2 EVT-P01~P04
 *
 * `commands/auth.ts`(Layer 3-1)와 같은 방식으로 판정 로직(run*)을 검증한다.
 * `createProgram`(auth.ts export)을 재사용한다 — commander 이중 설치 함정
 * (개발 지시 §4)을 그룹 전체가 하나의 헬퍼로 우회한다.
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
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: '프로젝트A',
  description: '설명',
  status: 'ready',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('runProjectCreate', () => {
  it('성공하면 프로젝트를 돌려준다', async () => {
    const client = fakeClient({ post: vi.fn().mockResolvedValue({ data: PROJECT_A }) });

    const result = await runProjectCreate({ client, name: '프로젝트A' });

    expect(result).toEqual({ ok: true, project: PROJECT_A });
  });

  it('이름 중복이면 name_conflict', async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockRejectedValue(new ApiRequestError(409, ErrorCode.PROJECT_NAME_CONFLICT, '중복')),
    });

    const result = await runProjectCreate({ client, name: '중복이름' });

    expect(result).toEqual({ ok: false, reason: 'name_conflict', name: '중복이름' });
  });

  it('서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      post: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });

    const result = await runProjectCreate({ client, name: 'X' });

    expect(result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      serverUrl: 'http://127.0.0.1:3000/api',
    });
  });

  it('예상 못한 에러는 그대로 전파한다', async () => {
    const client = fakeClient({ post: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(runProjectCreate({ client, name: 'X' })).rejects.toThrow('boom');
  });
});

describe('runProjectList', () => {
  it('목록 + 페이지 정보를 돌려준다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [PROJECT_A],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    });

    const result = await runProjectList({ client, page: 1 });

    expect(result).toEqual({
      ok: true,
      items: [PROJECT_A],
      page: 1,
      totalPages: 1,
      total: 1,
      status: undefined,
    });
  });

  it('--status를 쿼리에 실어 보낸다', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    const client = fakeClient({ get });

    await runProjectList({ client, status: 'running', page: 1 });

    expect(get).toHaveBeenCalledWith(expect.stringContaining('status=running'));
  });
});

describe('runProjectDetail', () => {
  const Detail = { ...PROJECT_A, agents: [] };

  it('전체 UUID로 상세를 조회한다', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: Detail }) });

    const result = await runProjectDetail({ client, idOrPrefix: PROJECT_A.id });

    expect(result).toEqual({ ok: true, project: Detail });
  });

  it('없는 ID면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.PROJECT_NOT_FOUND, '없음')),
    });

    const result = await runProjectDetail({ client, idOrPrefix: PROJECT_A.id });

    expect(result).toEqual({ ok: false, reason: 'not_found', id: PROJECT_A.id });
  });

  it(
    'REV-H-03 — ID 접두어 해석(resolveId) 중 서버가 끊기면 uncaught로 전파되지 않고 ' +
      'server_unreachable로 매핑된다',
    async () => {
      const client = fakeClient({
        get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
      });

      const result = await runProjectDetail({ client, idOrPrefix: PROJECT_A.id.slice(0, 8) });

      expect(result).toEqual({
        ok: false,
        reason: 'server_unreachable',
        serverUrl: 'http://127.0.0.1:3000/api',
      });
    },
  );

  it('8자 접두어가 여러 건과 겹치면 ambiguous', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [
          { id: 'a1a1a1a1-0000-0000-0000-000000000001', name: 'A' },
          { id: 'a1a1a1a2-0000-0000-0000-000000000002', name: 'B' },
        ],
        pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
      }),
    });

    const result = await runProjectDetail({ client, idOrPrefix: 'a1a1a1a' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('ambiguous');
  });
});

describe('runProjectStatusChange', () => {
  it('허용된 전이면 성공하고 캐스케이드가 없으면 cascade는 undefined', async () => {
    const client = fakeClient({
      patch: vi.fn().mockResolvedValue({ data: { ...PROJECT_A, status: 'running' } }),
    });

    const result = await runProjectStatusChange({
      client,
      idOrPrefix: PROJECT_A.id,
      newStatus: 'running',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.to).toBe('running');
    expect(result.cascade).toBeUndefined();
  });

  it('취소 시 캐스케이드 대상(Agent)을 스냅샷 diff로 찾아낸다 (개발 지시 §3(2))', async () => {
    const before = {
      ...PROJECT_A,
      status: 'running',
      agents: [
        {
          id: 'ag-1',
          name: 'Agent A',
          status: 'running',
          type: '',
          skill: '',
          config: {},
          retryCount: 0,
          projectId: PROJECT_A.id,
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
    const after = {
      ...PROJECT_A,
      status: 'cancelled',
      agents: [{ ...before.agents[0], status: 'cancelled' }],
    };
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: before })
      .mockResolvedValueOnce({ data: after });
    const client = fakeClient({
      get,
      patch: vi.fn().mockResolvedValue({ data: { ...PROJECT_A, status: 'cancelled' } }),
    });

    const result = await runProjectStatusChange({
      client,
      idOrPrefix: PROJECT_A.id,
      newStatus: 'cancelled',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.cascade).toEqual([
      { id: 'ag-1', label: 'Agent A', from: 'running', to: 'cancelled' },
    ]);
  });

  it('허용되지 않는 전이면 invalid_transition + allowedTransitions를 보존한다 (DEV-D-04)', async () => {
    const client = fakeClient({
      patch: vi.fn().mockRejectedValue(
        new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '허용되지 않는 전이', {
          allowedTransitions: ['running', 'cancelled'],
        }),
      ),
    });

    const result = await runProjectStatusChange({
      client,
      idOrPrefix: PROJECT_A.id,
      newStatus: 'completed',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_transition',
      message: '허용되지 않는 전이',
      allowed: ['running', 'cancelled'],
    });
  });
});

describe('registerProjectCommand — 출력·종료 코드', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-project-test-'));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  function buildTestProgram(client: CliApiClient, opts: { authenticated?: boolean } = {}) {
    if (opts.authenticated !== false) {
      saveAuth({ token: 't', expiresAt: '2099-01-01T00:00:00.000Z' }, homeDir);
    }

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
    registerProjectCommand(program, deps);

    return { program, logs, errors, getExitCode: () => exitCode };
  }

  it('인증되지 않았으면 client를 만들기 전에 exit 1', async () => {
    const createClient = vi.fn();
    const { program, errors, getExitCode } = buildTestProgram(
      {
        baseUrl: '',
        get: createClient,
        post: createClient,
        patch: createClient,
        delete: createClient,
      },
      { authenticated: false },
    );

    await program.parseAsync(['project', 'list'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('cm auth login');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('생성 성공 시 exit 0이고 출력에 필드가 담긴다', async () => {
    const client = fakeClient({ post: vi.fn().mockResolvedValue({ data: PROJECT_A }) });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['project', 'create', '--name', PROJECT_A.name], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain(PROJECT_A.id);
  });

  it('목록이 비어 있으면 안내 문구 + exit 0', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['project', 'list'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('프로젝트가 없습니다');
    expect(logs.join('\n')).toContain('cm project create --name <이름>');
  });

  it('허용되지 않는 전이면 exit 1이고 허용 목록을 출력한다 (DEV-D-04)', async () => {
    const client = fakeClient({
      patch: vi.fn().mockRejectedValue(
        new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '허용되지 않는 전이', {
          allowedTransitions: ['running', 'cancelled'],
        }),
      ),
    });
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['project', 'status', PROJECT_A.id, '--set', 'completed'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('running, cancelled');
  });

  it('project 하위에 create·list·status가 등록된다', () => {
    const { program } = buildTestProgram(fakeClient());
    const project = program.commands.find((c) => c.name() === 'project');
    const subNames = project?.commands.map((c) => c.name());
    expect(subNames).toEqual(expect.arrayContaining(['create', 'list', 'status']));
  });
});
