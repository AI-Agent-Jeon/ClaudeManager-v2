import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, ServerUnreachableError } from '../../../../src/cli/api-client.js';
import type { AuthApiClient } from '../../../../src/cli/commands/auth.js';
import {
  createProgram,
  defaultPromptSecret,
  registerAuthCommand,
  runLogin,
  runLogout,
  runStatus,
} from '../../../../src/cli/commands/auth.js';
import { loadAuth, saveAuth } from '../../../../src/cli/config.js';
import { ErrorCode } from '../../../../src/shared/constants.js';

/**
 * `cm auth login/logout/status` — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §4-1 EVT-A01~A03 · §5 PRM-01
 *
 * 판정 로직(run*)과 Commander 연결(registerAuthCommand)을 나눠 검증한다.
 * **토큰 원문이 결과값·콘솔 출력 어디에도 나타나지 않는지**를 명시적으로
 * 검증한다 (개발 지시 §4 요구사항).
 */

const SECRET_TOKEN = 'super-secret-jwt-token-should-never-be-printed';

function fakeClient(overrides: Partial<AuthApiClient> = {}): AuthApiClient {
  return {
    baseUrl: 'http://127.0.0.1:3000/api',
    post: vi.fn().mockRejectedValue(new Error('not stubbed')),
    get: vi.fn().mockRejectedValue(new Error('not stubbed')),
    ...overrides,
  };
}

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-auth-test-'));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe('runLogin', () => {
  it('Given 올바른 시크릿 When 로그인 Then 토큰을 저장하고 경로·만료일시만 돌려준다', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({
        data: { token: SECRET_TOKEN, expiresAt: '2026-09-09T00:00:00.000Z' },
      }),
    });

    const result = await runLogin({
      client,
      promptSecret: vi.fn().mockResolvedValue('correct-secret'),
      homeDir,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.expiresAt).toBe('2026-09-09T00:00:00.000Z');
    expect(result.configPath).toContain('config.json');
    // 결과 객체 어디에도 토큰 원문이 없다
    expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);

    // 실제로는 저장됐다
    expect(loadAuth(homeDir)?.token).toBe(SECRET_TOKEN);
  });

  it('Given 잘못된 시크릿 When 로그인 Then invalid_secret이고 저장하지 않는다', async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockRejectedValue(new ApiRequestError(401, ErrorCode.AUTH_INVALID_SECRET, '불일치')),
    });

    const result = await runLogin({
      client,
      promptSecret: vi.fn().mockResolvedValue('wrong'),
      homeDir,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_secret' });
    expect(loadAuth(homeDir)).toBeNull();
  });

  it('Given 서버 미기동 When 로그인 Then server_unreachable', async () => {
    const client = fakeClient({
      post: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });

    const result = await runLogin({
      client,
      promptSecret: vi.fn().mockResolvedValue('any'),
      homeDir,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      serverUrl: 'http://127.0.0.1:3000/api',
    });
  });

  it('Given Ctrl+C(프롬프트 취소) When 로그인 Then cancelled이고 API를 호출하지 않는다', async () => {
    const post = vi.fn();
    const client = fakeClient({ post });

    const result = await runLogin({
      client,
      promptSecret: vi.fn().mockRejectedValue(new Error('CANCELLED')),
      homeDir,
    });

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    expect(post).not.toHaveBeenCalled();
  });

  it('Given 비대화형 환경(파이프) When 로그인 Then not_interactive이고 API를 호출하지 않는다', async () => {
    const post = vi.fn();
    const client = fakeClient({ post });

    const result = await runLogin({
      client,
      promptSecret: vi.fn().mockRejectedValue(new Error('NOT_TTY')),
      homeDir,
    });

    expect(result).toEqual({ ok: false, reason: 'not_interactive' });
    expect(post).not.toHaveBeenCalled();
  });

  it('예상 못한 에러는 그대로 전파한다', async () => {
    const client = fakeClient({ post: vi.fn().mockRejectedValue(new Error('boom')) });

    await expect(
      runLogin({ client, promptSecret: vi.fn().mockResolvedValue('s'), homeDir }),
    ).rejects.toThrow('boom');
  });
});

describe('defaultPromptSecret — SEC-04 TTY 가드', () => {
  let stdinTTY: PropertyDescriptor | undefined;
  let stdoutTTY: PropertyDescriptor | undefined;

  beforeEach(() => {
    stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    stdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  });

  afterEach(() => {
    if (stdinTTY) Object.defineProperty(process.stdin, 'isTTY', stdinTTY);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', stdoutTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  function setTTY(stdin: boolean, stdout: boolean): void {
    Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
  }

  it('stdin은 TTY지만 stdout이 아니면(리다이렉트) NOT_TTY로 거부한다', async () => {
    // `cm auth login > login.log` 재현 — 이전 가드(stdin.isTTY만 확인)는
    // 이 경우를 통과시켜 readline이 terminal:false로 열리고 마스킹이
    // 무력화됐다(SEC-04). 지금은 stdout도 함께 확인해 여기서 막는다.
    setTTY(true, false);
    await expect(defaultPromptSecret('시크릿: ')).rejects.toThrow('NOT_TTY');
  });

  it('stdout은 TTY지만 stdin이 아니면 NOT_TTY로 거부한다', async () => {
    setTTY(false, true);
    await expect(defaultPromptSecret('시크릿: ')).rejects.toThrow('NOT_TTY');
  });

  it('stdin·stdout 둘 다 TTY가 아니면 NOT_TTY로 거부한다', async () => {
    setTTY(false, false);
    await expect(defaultPromptSecret('시크릿: ')).rejects.toThrow('NOT_TTY');
  });
});

describe('runLogout', () => {
  it('토큰이 있으면 삭제하고 hadToken: true', () => {
    saveAuth({ token: SECRET_TOKEN, expiresAt: '2026-09-09T00:00:00.000Z' }, homeDir);

    const result = runLogout({ homeDir });

    expect(result.hadToken).toBe(true);
    expect(loadAuth(homeDir)).toBeNull();
  });

  it('토큰이 없어도 예외 없이 hadToken: false', () => {
    const result = runLogout({ homeDir });
    expect(result.hadToken).toBe(false);
  });
});

describe('runStatus', () => {
  it('토큰이 없으면 not_authenticated', async () => {
    const result = await runStatus({ client: fakeClient(), homeDir });
    expect(result).toEqual({ ok: false, reason: 'not_authenticated' });
  });

  it('토큰이 만료됐으면 expired + 경과일', async () => {
    saveAuth({ token: 't', expiresAt: '2026-09-01T00:00:00.000Z' }, homeDir);

    const result = await runStatus({
      client: fakeClient(),
      homeDir,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'expired',
      expiresAt: '2026-09-01T00:00:00.000Z',
      elapsedDays: 3,
    });
  });

  it('유효한 토큰 + 서버 연결됨 → connected: true, 남은 일수 계산', async () => {
    saveAuth({ token: 't', expiresAt: '2026-09-10T00:00:00.000Z' }, homeDir);
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: { status: 'ok' } }) });

    const result = await runStatus({
      client,
      homeDir,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(result).toEqual({
      ok: true,
      connected: true,
      serverUrl: client.baseUrl,
      expiresAt: '2026-09-10T00:00:00.000Z',
      remainingDays: 6,
    });
  });

  it('유효한 토큰 + 서버 unreachable → connected: false + 경고', async () => {
    saveAuth({ token: 't', expiresAt: '2026-09-10T00:00:00.000Z' }, homeDir);
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });

    const result = await runStatus({
      client,
      homeDir,
      now: () => new Date('2026-09-04T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !('connected' in result)) throw new Error('unreachable');
    expect(result.connected).toBe(false);
  });

  it('예상 못한 에러는 그대로 전파한다', async () => {
    saveAuth({ token: 't', expiresAt: '2026-09-10T00:00:00.000Z' }, homeDir);
    const client = fakeClient({ get: vi.fn().mockRejectedValue(new Error('boom')) });

    await expect(
      runStatus({ client, homeDir, now: () => new Date('2026-09-04T00:00:00.000Z') }),
    ).rejects.toThrow('boom');
  });
});

describe('registerAuthCommand — 출력·종료 코드', () => {
  function buildTestProgram(client: AuthApiClient, promptSecret = vi.fn()) {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | undefined;

    const program = createProgram();
    program.exitOverride();
    registerAuthCommand(program, {
      createClient: () => client,
      promptSecret,
      homeDir,
      log: (msg) => logs.push(msg),
      errorLog: (msg) => errors.push(msg),
      setExitCode: (code) => {
        exitCode = code;
      },
    });

    return { program, logs, errors, getExitCode: () => exitCode };
  }

  it('로그인 성공 시 exit 0이고 출력에 토큰이 없다', async () => {
    const client = fakeClient({
      post: vi.fn().mockResolvedValue({
        data: { token: SECRET_TOKEN, expiresAt: '2026-09-09T00:00:00.000Z' },
      }),
    });
    const { program, logs, errors, getExitCode } = buildTestProgram(
      client,
      vi.fn().mockResolvedValue('correct-secret'),
    );

    await program.parseAsync(['auth', 'login'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    const allOutput = [...logs, ...errors].join('\n');
    expect(allOutput).not.toContain(SECRET_TOKEN);
    expect(allOutput).toContain('config.json');
  });

  it('로그인 실패(잘못된 시크릿) 시 exit 1', async () => {
    const client = fakeClient({
      post: vi
        .fn()
        .mockRejectedValue(new ApiRequestError(401, ErrorCode.AUTH_INVALID_SECRET, '불일치')),
    });
    const { program, getExitCode } = buildTestProgram(client, vi.fn().mockResolvedValue('wrong'));

    await program.parseAsync(['auth', 'login'], { from: 'user' });

    expect(getExitCode()).toBe(1);
  });

  it('logout은 항상 exit 0', async () => {
    const { program, getExitCode, logs } = buildTestProgram(fakeClient());

    await program.parseAsync(['auth', 'logout'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('로그아웃');
  });

  it('status: 미인증이면 exit 1', async () => {
    const { program, getExitCode, errors } = buildTestProgram(fakeClient());

    await program.parseAsync(['auth', 'status'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('cm auth login');
  });

  it('status: 유효한 토큰이면 exit 0이고 토큰 원문을 출력하지 않는다', async () => {
    saveAuth({ token: SECRET_TOKEN, expiresAt: '2099-01-01T00:00:00.000Z' }, homeDir);
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: { status: 'ok' } }) });
    const { program, getExitCode, logs } = buildTestProgram(client);

    await program.parseAsync(['auth', 'status'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).not.toContain(SECRET_TOKEN);
  });
});
