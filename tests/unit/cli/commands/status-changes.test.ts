import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServerUnreachableError } from '../../../../src/cli/api-client.js';
import { createProgram } from '../../../../src/cli/commands/auth.js';
import {
  registerStatusChangeCommand,
  runStatusChangeList,
} from '../../../../src/cli/commands/status-changes.js';
import { saveAuth } from '../../../../src/cli/config.js';
import type { CliApiClient, CommandDeps } from '../../../../src/cli/runtime.js';

/**
 * `cm status-changes` — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-SC01 · §4-4 EVT-SC01-1~3
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

const CHANGE_1 = {
  id: 1,
  entityType: 'project',
  entityId: 'p1111111-e5f6-7890-abcd-ef1234567890',
  fromStatus: null,
  toStatus: 'ready',
  changedBy: 'system',
  changedAt: '2026-09-01T00:00:00.000Z',
};
const CHANGE_2 = {
  id: 2,
  entityType: 'project',
  entityId: 'p1111111-e5f6-7890-abcd-ef1234567890',
  fromStatus: 'ready',
  toStatus: 'running',
  changedBy: 'user',
  changedAt: '2026-09-01T01:00:00.000Z',
};

describe('runStatusChangeList', () => {
  it('목록 + 페이지 정보를 돌려준다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [CHANGE_1, CHANGE_2],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      }),
    });

    const result = await runStatusChangeList({ client, page: 1 });

    expect(result).toEqual({
      ok: true,
      items: [CHANGE_1, CHANGE_2],
      page: 1,
      totalPages: 1,
      total: 2,
      entityType: undefined,
      entityId: undefined,
    });
  });

  it('entityType·entityId를 쿼리에 실어 보낸다', async () => {
    const get = vi.fn().mockResolvedValue({
      data: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
    const client = fakeClient({ get });

    await runStatusChangeList({ client, entityType: 'project', entityId: 'p1', page: 1 });

    const calledPath = get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain('entityType=project');
    expect(calledPath).toContain('entityId=p1');
  });

  it('서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });

    const result = await runStatusChangeList({ client, page: 1 });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('server_unreachable');
  });
});

describe('registerStatusChangeCommand — 출력·종료 코드', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-status-changes-test-'));
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
    registerStatusChangeCommand(program, deps);

    return { program, logs, errors, getExitCode: () => exitCode };
  }

  it('필터 없이 조회하면 ID 컬럼이 포함되고 exit 0 (EVT-SC01-2)', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [CHANGE_1],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['status-changes'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    const out = logs.join('\n');
    expect(out).toContain('ID');
    expect(out).toContain(CHANGE_1.entityId.slice(0, 8));
  });

  it('--entity-id로 필터링하면 ID 컬럼이 빠진다 (§3 SCR-SC01)', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [CHANGE_2],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['status-changes', '--entity-id', CHANGE_2.entityId], {
      from: 'user',
    });

    expect(getExitCode()).toBe(0);
    const headerLine = logs.join('\n').split('\n')[2] ?? '';
    expect(headerLine).not.toContain(' ID ');
  });

  it('이력이 없으면 안내 문구 + exit 0', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({
        data: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      }),
    });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['status-changes', '--entity-id', 'none'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('상태 변경 이력이 없습니다');
  });

  it('인증되지 않았으면 exit 1', async () => {
    rmSync(homeDir, { recursive: true, force: true });
    homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-status-changes-noauth-'));
    const client = fakeClient();
    const { program, getExitCode, errors } = buildTestProgram(client);

    await program.parseAsync(['status-changes'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('cm auth login');
  });

  it('status-changes 명령이 최상위에 등록된다', () => {
    const { program } = buildTestProgram(fakeClient());
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('status-changes');
  });
});
