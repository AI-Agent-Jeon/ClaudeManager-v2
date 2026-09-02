import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, ServerUnreachableError } from '../../../../src/cli/api-client.js';
import { createProgram } from '../../../../src/cli/commands/auth.js';
import {
  registerChatCommand,
  resolveConversationId,
  resolveExportPath,
  runChatAgentOpen,
  runChatExport,
  runChatList,
  runChatLog,
  runChatMainOpen,
  runChatRepl,
  runChatSearch,
  runChatSend,
} from '../../../../src/cli/commands/chat.js';
import { saveAuth } from '../../../../src/cli/config.js';
import type { CliApiClient } from '../../../../src/cli/runtime.js';
import { ErrorCode } from '../../../../src/shared/constants.js';

/**
 * `cm chat main/agent/send/list/log/search` — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-CH01~03·11~13 · §4-5 EVT-CH01~03·11~13
 *
 * 그룹 A(`project.test.ts`·`agent.test.ts`)와 같은 관용구 — `run*` 판정
 * 로직은 `fakeClient`(CliApiClient 인터페이스만 흉내)로 검증하고,
 * `registerChatCommand`는 `createProgram()`(auth.ts, commander v14 고정)으로
 * commander 이중 설치 함정을 우회한다.
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

/**
 * 경로별로 다른 응답을 돌려주는 `client.get` 목. `CliApiClient['get']`는
 * `<T>(path: string) => Promise<T>` 제네릭이라 `vi.fn(impl)`에 구체 반환
 * 타입을 그대로 주면 제네릭에 대입할 수 없다(호출부마다 T가 다르다) —
 * `noExplicitAny`를 피하려고 `any`를 흩뿌리는 대신 이 헬퍼 하나에만
 * 단언을 모은다.
 */
function routedGet(handler: (path: string) => unknown): CliApiClient['get'] {
  return vi.fn((path: string) => Promise.resolve(handler(path))) as unknown as CliApiClient['get'];
}

const CONV_MAIN = {
  id: 'c0000000-e5f6-7890-abcd-ef1234567890',
  channelType: 'main',
  entityId: null,
  status: 'active',
  entitySnapshot: null,
  title: 'Main',
  unreadCount: 0,
  lastMessageAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  archivedAt: null,
};

const CONV_AGENT = {
  id: 'c1111111-e5f6-7890-abcd-ef1234567890',
  channelType: 'agent',
  entityId: 'a1111111-e5f6-7890-abcd-ef1234567890',
  status: 'active',
  entitySnapshot: null,
  title: 'dev-sub-01',
  unreadCount: 2,
  lastMessageAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  archivedAt: null,
};

const AGENT_DETAIL = {
  id: 'a1111111-e5f6-7890-abcd-ef1234567890',
  projectId: 'p1111111-e5f6-7890-abcd-ef1234567890',
  name: 'dev-sub-01',
  type: 'dev',
  status: 'running',
  skill: 'develop',
  config: {},
  retryCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  tasks: [],
  waitingReason: null,
  conversationId: CONV_AGENT.id,
};

function msg(id: string, body: string, createdAt: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    conversationId: CONV_MAIN.id,
    msgType: 'MSG-01',
    senderRole: 'ceo',
    body,
    structured: null,
    approvalId: null,
    createdAt,
    ...overrides,
  };
}

describe('resolveConversationId', () => {
  it('전체 UUID·앞 8자리 모두로 찾는다 (상태 3종을 조회해 합친다)', async () => {
    const get = routedGet((path) => {
      if (path.includes('status=active')) return { data: [CONV_AGENT] };
      return { data: [] };
    });
    const client = fakeClient({ get });

    const result = await resolveConversationId(client, CONV_AGENT.id.slice(0, 8));

    expect(result).toEqual({ ok: true, conversation: CONV_AGENT });
    expect(get).toHaveBeenCalledTimes(3); // active·readonly·archived
  });

  it('없으면 not_found', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const result = await resolveConversationId(client, 'zzzzzzzz');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('접두어가 여러 건과 겹치면 ambiguous', async () => {
    const dup = { ...CONV_AGENT, id: 'c1111199-e5f6-7890-abcd-ef1234567890' };
    const get = routedGet((path) => {
      if (path.includes('status=active')) return { data: [CONV_AGENT, dup] };
      return { data: [] };
    });
    const client = fakeClient({ get });

    const result = await resolveConversationId(client, 'c1111');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('ambiguous');
  });
});

describe('runChatMainOpen', () => {
  it('CH-MAIN을 열고 최근 메시지를 오래된 순으로 뒤집어 돌려준다', async () => {
    const messages = [
      msg('m2', '두 번째', '2026-09-01T00:02:00.000Z'),
      msg('m1', '첫 번째', '2026-09-01T00:01:00.000Z'),
    ];
    const get = routedGet((path) => {
      if (path.includes('type=main')) return { data: [CONV_MAIN] };
      return { data: messages, cursor: { next: null, hasMore: false } };
    });
    const client = fakeClient({ get });

    const result = await runChatMainOpen({ client });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.conversation).toEqual(CONV_MAIN);
    expect(result.messages.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('CH-MAIN이 없으면 conversation_not_found', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const result = await runChatMainOpen({ client });
    expect(result).toEqual({ ok: false, reason: 'conversation_not_found' });
  });

  it('서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });
    const result = await runChatMainOpen({ client });
    expect(result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      serverUrl: 'http://127.0.0.1:3000/api',
    });
  });
});

describe('runChatAgentOpen', () => {
  it('active 채널이면 최근 메시지만 조회하고 readonly:false', async () => {
    const get = routedGet((path) => {
      if (path === `/agents/${AGENT_DETAIL.id}`) return { data: AGENT_DETAIL };
      return { data: [], cursor: { next: null, hasMore: false } };
    });
    const client = fakeClient({ get });

    const result = await runChatAgentOpen({ client, idOrPrefix: AGENT_DETAIL.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.readonly).toBe(false);
  });

  it('Agent가 completed/cancelled면 readonly:true이고 전체 로그를 조회한다 (DES-007 v2 §8)', async () => {
    const done = { ...AGENT_DETAIL, status: 'completed' };
    const get = routedGet((path) => {
      if (path === `/agents/${AGENT_DETAIL.id}`) return { data: done };
      return {
        data: [msg('m1', 'a', '2026-09-01T00:00:00.000Z')],
        cursor: { next: null, hasMore: false },
      };
    });
    const client = fakeClient({ get });

    const result = await runChatAgentOpen({ client, idOrPrefix: AGENT_DETAIL.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.readonly).toBe(true);
  });

  it('없는 Agent면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.AGENT_NOT_FOUND, '없음')),
    });
    const result = await runChatAgentOpen({ client, idOrPrefix: AGENT_DETAIL.id });
    expect(result).toEqual({ ok: false, reason: 'not_found', id: AGENT_DETAIL.id });
  });

  it('conversationId가 없으면 no_conversation (방어적 분기)', async () => {
    const noConv = { ...AGENT_DETAIL, conversationId: null };
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: noConv }) });
    const result = await runChatAgentOpen({ client, idOrPrefix: AGENT_DETAIL.id });
    expect(result).toEqual({ ok: false, reason: 'no_conversation', agentId: AGENT_DETAIL.id });
  });

  it(
    'REV-H-04 — Agent 조회는 성공한 뒤 메시지 조회에서 서버가 끊기면 uncaught로 ' +
      '전파되지 않고 server_unreachable로 매핑된다 (runChatMainOpen과 같은 보호)',
    async () => {
      const get = routedGet((path) => {
        if (path === `/agents/${AGENT_DETAIL.id}`) return { data: AGENT_DETAIL };
        throw new ServerUnreachableError('http://127.0.0.1:3000/api');
      });
      const client = fakeClient({ get });

      const result = await runChatAgentOpen({ client, idOrPrefix: AGENT_DETAIL.id });

      expect(result).toEqual({
        ok: false,
        reason: 'server_unreachable',
        serverUrl: 'http://127.0.0.1:3000/api',
      });
    },
  );
});

describe('runChatRepl', () => {
  it('여러 줄을 전송하고 /exit로 종료한다', async () => {
    const post = vi.fn().mockResolvedValue({ data: msg('s1', '안녕', '2026-09-01T00:00:00.000Z') });
    const client = fakeClient({ post });
    const lines = ['첫 메시지', '', '두 번째 메시지', '/exit'];
    const readLine = vi.fn(async (): Promise<string | null> => lines.shift() ?? null);
    const log = vi.fn();
    const errorLog = vi.fn();

    const result = await runChatRepl({ client, conversationId: 'c1', readLine, log, errorLog });

    expect(result.sentCount).toBe(2); // 빈 줄은 세지 않는다
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('Ctrl+C·Ctrl+D(readLine이 null)면 즉시 종료한다', async () => {
    const client = fakeClient();
    const readLine = vi.fn().mockResolvedValue(null);
    const result = await runChatRepl({
      client,
      conversationId: 'c1',
      readLine,
      log: vi.fn(),
      errorLog: vi.fn(),
    });
    expect(result.sentCount).toBe(0);
  });

  it('CONVERSATION_ARCHIVED를 만나면 세션을 종료한다', async () => {
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(409, ErrorCode.CONVERSATION_ARCHIVED, '종료된 채널'));
    const client = fakeClient({ post });
    const lines = ['메시지', '더 안 보내야 함'];
    const readLine = vi.fn(async (): Promise<string | null> => lines.shift() ?? null);
    const errorLog = vi.fn();

    const result = await runChatRepl({
      client,
      conversationId: 'c1',
      readLine,
      log: vi.fn(),
      errorLog,
    });

    expect(result.sentCount).toBe(0);
    expect(post).toHaveBeenCalledTimes(1); // 아카이브 감지 후 루프를 더 돌지 않는다
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('종료된 채널'));
  });
});

describe('runChatSend', () => {
  it('channel이 "main"이면 CH-MAIN에 보낸다', async () => {
    const get = vi.fn().mockResolvedValue({ data: [CONV_MAIN] });
    const post = vi.fn().mockResolvedValue({ data: msg('s1', '안녕', '2026-09-01T00:00:00.000Z') });
    const client = fakeClient({ get, post });

    const result = await runChatSend({ client, channel: 'main', body: '안녕' });

    expect(result).toEqual({
      ok: true,
      message: msg('s1', '안녕', '2026-09-01T00:00:00.000Z'),
      conversationTitle: 'Main',
    });
    expect(post).toHaveBeenCalledWith(`/conversations/${CONV_MAIN.id}/messages`, { body: '안녕' });
  });

  it('channel이 Agent ID면 그 Agent의 CH-AGENT에 보낸다', async () => {
    const get = routedGet((path) => {
      if (path === `/agents/${AGENT_DETAIL.id}`) return { data: AGENT_DETAIL };
      throw new Error(`unexpected ${path}`);
    });
    const post = vi.fn().mockResolvedValue({ data: msg('s1', 'hi', '2026-09-01T00:00:00.000Z') });
    const client = fakeClient({ get, post });

    const result = await runChatSend({ client, channel: AGENT_DETAIL.id, body: 'hi' });

    expect(result.ok).toBe(true);
    expect(post).toHaveBeenCalledWith(`/conversations/${CONV_AGENT.id}/messages`, { body: 'hi' });
  });

  it('없는 Agent면 not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.AGENT_NOT_FOUND, '없음')),
    });
    const result = await runChatSend({ client, channel: AGENT_DETAIL.id, body: 'hi' });
    expect(result).toEqual({ ok: false, reason: 'not_found', id: AGENT_DETAIL.id });
  });

  it('CONVERSATION_ARCHIVED면 conversation_archived (EVT-CH03-2)', async () => {
    const get = vi.fn().mockResolvedValue({ data: [CONV_MAIN] });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(409, ErrorCode.CONVERSATION_ARCHIVED, '종료된 채널'));
    const client = fakeClient({ get, post });

    const result = await runChatSend({ client, channel: 'main', body: 'hi' });

    expect(result).toEqual({ ok: false, reason: 'conversation_archived' });
  });
});

describe('runChatList', () => {
  it('목록 + 필터를 돌려준다', async () => {
    const get = vi.fn().mockResolvedValue({ data: [CONV_MAIN, CONV_AGENT] });
    const client = fakeClient({ get });

    const result = await runChatList({ client, type: 'agent', status: 'active' });

    expect(result).toEqual({
      ok: true,
      items: [CONV_MAIN, CONV_AGENT],
      type: 'agent',
      status: 'active',
    });
    expect(get).toHaveBeenCalledWith(expect.stringContaining('type=agent'));
    expect(get).toHaveBeenCalledWith(expect.stringContaining('status=active'));
  });

  it('서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });
    const result = await runChatList({ client });
    expect(result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      serverUrl: 'http://127.0.0.1:3000/api',
    });
  });
});

describe('runChatLog — 커서 페이지네이션', () => {
  it('다음 페이지를 이어 붙여도 메시지가 중복되지 않고 시간순으로 정렬된다 (개발 지시 §4)', async () => {
    const page1 = {
      data: [
        msg('m3', '세 번째', '2026-09-01T00:03:00.000Z'),
        msg('m2', '두 번째', '2026-09-01T00:02:00.000Z'),
      ],
      cursor: { next: 'CURSOR1', hasMore: true },
    };
    const page2 = {
      data: [msg('m1', '첫 번째', '2026-09-01T00:01:00.000Z')],
      cursor: { next: null, hasMore: false },
    };
    const get = routedGet((path) => {
      if (path.includes('status=active')) return { data: [CONV_MAIN] };
      if (path.includes('status=')) return { data: [] };
      if (path.includes('cursor=')) return page2;
      return page1;
    });
    const client = fakeClient({ get });

    const result = await runChatLog({ client, idOrPrefix: CONV_MAIN.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const ids = result.messages.map((m) => m.id);
    expect(ids).toEqual(['m1', 'm2', 'm3']); // 시간순, 중복 없음
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('--since로 필터링한다', async () => {
    const page1 = {
      data: [
        msg('m2', '두 번째', '2026-09-01T00:02:00.000Z'),
        msg('m1', '첫 번째', '2026-09-01T00:01:00.000Z'),
      ],
      cursor: { next: null, hasMore: false },
    };
    const get = routedGet((path) => {
      if (path.includes('status=active')) return { data: [CONV_MAIN] };
      if (path.includes('status=')) return { data: [] };
      return page1;
    });
    const client = fakeClient({ get });

    const result = await runChatLog({
      client,
      idOrPrefix: CONV_MAIN.id,
      since: '2026-09-01T00:01:30.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.messages.map((m) => m.id)).toEqual(['m2']);
  });

  it('--since 값이 날짜가 아니면 invalid_since', async () => {
    const client = fakeClient();
    const result = await runChatLog({ client, idOrPrefix: CONV_MAIN.id, since: '이상한값' });
    expect(result).toEqual({ ok: false, reason: 'invalid_since', value: '이상한값' });
  });

  it('없는 채널이면 not_found', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const result = await runChatLog({ client, idOrPrefix: 'zzzzzzzz' });
    expect(result).toEqual({ ok: false, reason: 'not_found', id: 'zzzzzzzz' });
  });
});

describe('resolveExportPath', () => {
  const cwd = '/home/ceo/work';

  it('경로를 안 주면 CWD + 기본 파일명', () => {
    const result = resolveExportPath(cwd, undefined, 'conversation-abc.md');
    expect(result).toEqual({ ok: true, path: resolvePath(cwd, 'conversation-abc.md') });
  });

  it('CWD 밖으로 벗어나는 상대 경로는 거부한다 (상위 탈출 방지)', () => {
    const result = resolveExportPath(cwd, '../../etc/passwd', 'default.md');
    expect(result.ok).toBe(false);
  });

  it('CWD 하위 상대 경로는 허용한다', () => {
    const result = resolveExportPath(cwd, 'exports/out.md', 'default.md');
    expect(result.ok).toBe(true);
  });
});

describe('runChatExport', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'cm-cli-chat-export-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('마크다운을 파일로 저장한다', async () => {
    const get = routedGet((path) => {
      if (path.includes('status=active')) return { data: [CONV_MAIN] };
      return { data: [] };
    });
    const getText = vi.fn().mockResolvedValue('# Main\n\n본문');
    const client = { ...fakeClient({ get }), getText };

    const result = await runChatExport({
      client,
      idOrPrefix: CONV_MAIN.id,
      cwd,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(existsSync(result.savedPath)).toBe(true);
    expect(readFileSync(result.savedPath, 'utf-8')).toBe('# Main\n\n본문');
  });

  it('없는 채널이면 not_found', async () => {
    const getText = vi.fn();
    const client = { ...fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) }), getText };

    const result = await runChatExport({
      client,
      idOrPrefix: 'zzzzzzzz',
      cwd,
      now: () => new Date(),
    });

    expect(result).toEqual({ ok: false, reason: 'not_found', id: 'zzzzzzzz' });
    expect(getText).not.toHaveBeenCalled();
  });
});

describe('runChatSearch', () => {
  it('2자 미만이면 too_short (호출 전 검증, 서버를 부르지 않는다)', async () => {
    const get = vi.fn();
    const client = fakeClient({ get });
    const result = await runChatSearch({ client, q: 'a' });
    expect(result).toEqual({ ok: false, reason: 'too_short', q: 'a' });
    expect(get).not.toHaveBeenCalled();
  });

  it('결과가 있으면 그대로 돌려준다', async () => {
    const items = [
      {
        messageId: 'm1',
        conversationId: CONV_MAIN.id,
        conversationTitle: 'Main',
        snippet: '…<mark>설계서</mark>를 개정했습니다…',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ];
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: items }) });

    const result = await runChatSearch({ client, q: '설계서' });

    expect(result).toEqual({ ok: true, items, q: '설계서' });
  });

  it('결과 0건도 정상 결과다', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const result = await runChatSearch({ client, q: '없는말' });
    expect(result).toEqual({ ok: true, items: [], q: '없는말' });
  });
});

describe('registerChatCommand — 출력·종료 코드', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-chat-test-'));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  function buildTestProgram(
    client: CliApiClient,
    opts: {
      authenticated?: boolean;
      isInteractive?: boolean;
      readLines?: Array<string | null>;
    } = {},
  ) {
    if (opts.authenticated !== false) {
      saveAuth({ token: 't', expiresAt: '2099-01-01T00:00:00.000Z' }, homeDir);
    }

    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | undefined;
    const lines = [...(opts.readLines ?? [])];
    const closeSpy = vi.fn();

    const program = createProgram();
    program.exitOverride();
    const deps = {
      createClient: () => client,
      homeDir,
      log: (msg: string) => logs.push(msg),
      errorLog: (msg: string) => errors.push(msg),
      setExitCode: (code: number) => {
        exitCode = code;
      },
      createReadLine: () => ({
        readLine: async () => lines.shift() ?? null,
        close: closeSpy,
      }),
      isInteractive: () => opts.isInteractive ?? true,
      cwd: () => homeDir,
    };
    registerChatCommand(program, deps);

    return { program, logs, errors, getExitCode: () => exitCode, closeSpy };
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

    await program.parseAsync(['chat', 'list'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('cm auth login');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('비대화형 환경에서는 REPL을 띄우지 않는다 (cm chat main)', async () => {
    const client = fakeClient();
    const { program, errors, getExitCode } = buildTestProgram(client, { isInteractive: false });

    await program.parseAsync(['chat', 'main'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('대화형 터미널이 아닙니다');
  });

  it('cm chat main — 메시지 전송 후 /exit로 정상 종료한다', async () => {
    const get = routedGet((path) => {
      if (path.includes('type=main')) return { data: [CONV_MAIN] };
      return { data: [], cursor: { next: null, hasMore: false } };
    });
    const post = vi.fn().mockResolvedValue({ data: msg('s1', '안녕', '2026-09-01T00:00:00.000Z') });
    const client = fakeClient({ get, post });
    const { program, logs, getExitCode, closeSpy } = buildTestProgram(client, {
      readLines: ['안녕', '/exit'],
    });

    await program.parseAsync(['chat', 'main'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('세션 종료');
    expect(logs.join('\n')).toContain('전송 1건');
    expect(closeSpy).toHaveBeenCalled(); // readline 인터페이스를 닫는다 — 프로세스가 멈춰있지 않는다
  });

  it('cm chat agent <id> — 아카이브·readonly 채널은 로그만 보여주고 REPL을 열지 않는다', async () => {
    const done = { ...AGENT_DETAIL, status: 'completed' };
    const get = routedGet((path) => {
      if (path === `/agents/${AGENT_DETAIL.id}`) return { data: done };
      return {
        data: [msg('m1', '완료 보고', '2026-09-01T00:00:00.000Z')],
        cursor: { next: null, hasMore: false },
      };
    });
    const client = fakeClient({ get });
    const { program, errors, getExitCode, closeSpy } = buildTestProgram(client);

    await program.parseAsync(['chat', 'agent', AGENT_DETAIL.id], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(errors.join('\n')).toContain('읽기 전용');
    expect(closeSpy).not.toHaveBeenCalled(); // REPL 자체를 안 열었으니 readline도 안 만든다
  });

  it('cm chat agent <없는id> — not_found', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.AGENT_NOT_FOUND, '없음')),
    });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['chat', 'agent', AGENT_DETAIL.id], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('찾을 수 없습니다');
  });

  it('cm chat send main "<본문>" — 비대화형 1회 전송', async () => {
    const get = vi.fn().mockResolvedValue({ data: [CONV_MAIN] });
    const post = vi.fn().mockResolvedValue({ data: msg('s1', '지시', '2026-09-01T00:00:00.000Z') });
    const client = fakeClient({ get, post });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['chat', 'send', 'main', '지시'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('전송 완료');
  });

  it('cm chat list — 빈 목록', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['chat', 'list'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('대화 채널이 없습니다');
  });

  it('cm chat log <channelId> — 전체 로그를 출력한다', async () => {
    const get = routedGet((path) => {
      if (path.includes('status=active')) return { data: [CONV_MAIN] };
      if (path.includes('status=')) return { data: [] };
      return {
        data: [msg('m1', '안녕하세요', '2026-09-01T00:00:00.000Z')],
        cursor: { next: null, hasMore: false },
      };
    });
    const client = fakeClient({ get });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['chat', 'log', CONV_MAIN.id], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('안녕하세요');
  });

  it('cm chat log <channelId> --export — 마크다운 파일로 저장한다', async () => {
    const get = routedGet((path) => {
      if (path.includes('status=active')) return { data: [CONV_MAIN] };
      return { data: [] };
    });
    const getText = vi.fn().mockResolvedValue('# Main\n\n본문');
    const client = { ...fakeClient({ get }), getText };
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['chat', 'log', CONV_MAIN.id, '--export'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('마크다운 내보내기 완료');
    expect(getText).toHaveBeenCalledWith(`/conversations/${CONV_MAIN.id}/export`);
  });

  it('cm chat search "<1자>" — 검증 실패', async () => {
    const client = fakeClient();
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['chat', 'search', 'a'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('2자 이상');
  });

  it('chat 하위에 main·agent·send·list·log·search가 등록된다', () => {
    const { program } = buildTestProgram(fakeClient());
    const chat = program.commands.find((c) => c.name() === 'chat');
    const subNames = chat?.commands.map((c) => c.name());
    expect(subNames).toEqual(
      expect.arrayContaining(['main', 'agent', 'send', 'list', 'log', 'search']),
    );
  });
});
