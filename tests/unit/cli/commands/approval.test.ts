import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, ServerUnreachableError } from '../../../../src/cli/api-client.js';
import {
  registerApprovalCommand,
  resolveApprovalId,
  runApprovalsList,
  runDecide,
  runInbox,
  runReview,
} from '../../../../src/cli/commands/approval.js';
import { createProgram } from '../../../../src/cli/commands/auth.js';
import { saveAuth } from '../../../../src/cli/config.js';
import type { CliApiClient } from '../../../../src/cli/runtime.js';
import { ErrorCode } from '../../../../src/shared/constants.js';

/**
 * `cm inbox`/`cm decide`/`cm approvals`/`cm review` — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-CH04·05·07·08 · §4-4 EVT-CH04·05·07·08
 *
 * 그룹 A·B와 같은 관용구 — `run*` 판정 로직은 `fakeClient`로 검증하고,
 * `registerApprovalCommand`는 `createProgram()`(commander v14 고정)으로
 * 이중 설치 함정을 우회한다.
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

/** 경로별로 다른 응답을 돌려주는 `client.get`/`client.post` 목 — `chat.test.ts`와 같은 헬퍼 */
function routed(
  handler: (path: string, body?: unknown) => unknown,
): (path: string, body?: unknown) => Promise<unknown> {
  return vi.fn((path: string, body?: unknown) =>
    Promise.resolve(handler(path, body)),
  ) as unknown as (path: string, body?: unknown) => Promise<unknown>;
}

const OPT_A = { code: 'A', label: '승인', recommended: true };
const OPT_B = { code: 'B', label: '반려' };

const APV_GATE_PENDING = {
  id: 'ap111111-e5f6-7890-abcd-ef1234567890',
  approvalType: 'APV-GATE',
  level: 'high',
  subject: 'plan → analyze 전환 승인',
  requestedBy: 'main',
  status: 'pending',
  deadlineAt: null,
  elapsedSeconds: 3660,
  remainingSeconds: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

const APV_CHOICE_PENDING = {
  id: 'ap222222-e5f6-7890-abcd-ef1234567890',
  approvalType: 'APV-CHOICE',
  level: 'medium',
  subject: '테스트 전략 선택',
  requestedBy: 'a1111111-e5f6-7890-abcd-ef1234567890',
  status: 'pending',
  deadlineAt: '2026-09-01T00:30:00.000Z',
  elapsedSeconds: 120,
  remainingSeconds: 1680,
  createdAt: '2026-09-01T00:00:00.000Z',
};

const APV_RESOLVED = {
  ...APV_CHOICE_PENDING,
  id: 'ap333333-e5f6-7890-abcd-ef1234567890',
  status: 'approved',
};

interface ApprovalSummaryLike {
  id: string;
  approvalType: string;
  level: string;
  subject: string;
  requestedBy: string;
  status: string;
  deadlineAt: string | null;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  createdAt: string;
}

function detailOf(summary: ApprovalSummaryLike, overrides: Record<string, unknown> = {}) {
  return {
    ...summary,
    options: [OPT_A, OPT_B],
    artifacts: [
      {
        code: 'PLN-001',
        title: '요구사항 정의서',
        notionUrl: 'https://app.notion.com/p/plan1',
        gitPath: 'docs/requirements/pln-001-requirements.md',
        syncStatus: 'synced',
      },
    ],
    rationale: 'Must 19건 전건 수용 기준 작성 완료',
    impact: { documents: ['PLN-002'], reversible: true },
    messageId: 'msg-1',
    stageId: 'stage-analyze-1',
    resolution: null,
    reason: null,
    resolvedAt: null,
    ...overrides,
  };
}

const PHASE_CURRENT = {
  phase: { id: 'phase-1', number: 1, name: 'Phase 1', currentStage: 'plan' },
  stages: [
    {
      id: 'stage-analyze-1',
      skill: 'analyze',
      status: 'pending',
      startedAt: null,
      completedAt: null,
      artifactCount: 0,
      pendingApprovalCount: 0,
      gate: { required: true, approvalId: null, passed: false },
    },
  ],
  wipViolations: [],
};

describe('resolveApprovalId', () => {
  it('전체 UUID·앞 8자리 모두로 찾는다', async () => {
    const get = routed(() => ({ data: [APV_GATE_PENDING, APV_CHOICE_PENDING] }));
    const client = fakeClient({ get: get as CliApiClient['get'] });

    const result = await resolveApprovalId(client, APV_GATE_PENDING.id.slice(0, 8));

    expect(result).toEqual({ ok: true, id: APV_GATE_PENDING.id });
  });

  it('없으면 not_found', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const result = await resolveApprovalId(client, 'zzzzzzzz');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('접두어가 여러 건과 겹치면 ambiguous', async () => {
    const dup = { ...APV_GATE_PENDING, id: 'ap111199-e5f6-7890-abcd-ef1234567890' };
    const get = vi.fn().mockResolvedValue({ data: [APV_GATE_PENDING, dup] });
    const client = fakeClient({ get });

    const result = await resolveApprovalId(client, 'ap1111');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('ambiguous');
  });
});

describe('runInbox', () => {
  it('pending 건 목록을 돌려준다', async () => {
    const get = routed((path) => {
      expect(path).toContain('status=pending');
      return { data: [APV_GATE_PENDING, APV_CHOICE_PENDING] };
    });
    const client = fakeClient({ get: get as CliApiClient['get'] });

    const result = await runInbox({ client });

    expect(result).toEqual({ ok: true, items: [APV_GATE_PENDING, APV_CHOICE_PENDING] });
  });

  it('서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });
    const result = await runInbox({ client });
    expect(result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      serverUrl: 'http://127.0.0.1:3000/api',
    });
  });

  it('401이면 unauthenticated', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(401, ErrorCode.UNAUTHORIZED, '')),
    });
    const result = await runInbox({ client });
    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
  });
});

describe('runApprovalsList', () => {
  it('--pending은 서버 필터를 쓴다', async () => {
    const get = routed((path) => {
      expect(path).toContain('status=pending');
      return { data: [APV_GATE_PENDING] };
    });
    const client = fakeClient({ get: get as CliApiClient['get'] });

    const result = await runApprovalsList({ client, pending: true });

    expect(result).toEqual({ ok: true, items: [APV_GATE_PENDING], filter: 'pending' });
  });

  it('--resolved는 클라이언트에서 pending이 아닌 건만 남긴다', async () => {
    const get = vi.fn().mockResolvedValue({ data: [APV_GATE_PENDING, APV_RESOLVED] });
    const client = fakeClient({ get });

    const result = await runApprovalsList({ client, resolved: true });

    expect(result).toEqual({ ok: true, items: [APV_RESOLVED], filter: 'resolved' });
  });

  it('필터 없으면 전건', async () => {
    const get = vi.fn().mockResolvedValue({ data: [APV_GATE_PENDING, APV_RESOLVED] });
    const client = fakeClient({ get });

    const result = await runApprovalsList({ client });

    expect(result).toEqual({
      ok: true,
      items: [APV_GATE_PENDING, APV_RESOLVED],
      filter: undefined,
    });
  });
});

describe('runReview', () => {
  it('options·artifacts·rationale·impact 4개를 전부 돌려준다 (이 그룹의 핵심 회귀)', async () => {
    const detail = detailOf(APV_GATE_PENDING);
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_GATE_PENDING] };
      if (path === `/approvals/${APV_GATE_PENDING.id}`) return { data: detail };
      if (path === '/phases/current') return { data: PHASE_CURRENT };
      throw new Error(`unexpected ${path}`);
    });
    const client = fakeClient({ get: get as CliApiClient['get'] });

    const result = await runReview({ client, idOrPrefix: APV_GATE_PENDING.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.approval.options).toEqual([OPT_A, OPT_B]);
    expect(result.approval.artifacts).toHaveLength(1);
    expect(result.approval.rationale).toBe('Must 19건 전건 수용 기준 작성 완료');
    expect(result.approval.impact).toEqual({ documents: ['PLN-002'], reversible: true });
    // 단계명 — stageId → phases/current 조회로 스킬명을 해석한다
    expect(result.stageSkill).toBe('analyze');
  });

  it('artifacts의 syncStatus가 notion_only·missing을 구분해 표시된다', async () => {
    const detail = detailOf(APV_GATE_PENDING, {
      artifacts: [
        {
          code: 'PLN-001',
          title: '요구사항 정의서',
          notionUrl: 'https://app.notion.com/p/plan1',
          gitPath: null,
          syncStatus: 'notion_only',
        },
        {
          code: 'PLN-002',
          title: 'PLN-002',
          notionUrl: null,
          gitPath: null,
          syncStatus: 'missing',
        },
      ],
    });
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_GATE_PENDING] };
      if (path === `/approvals/${APV_GATE_PENDING.id}`) return { data: detail };
      if (path === '/phases/current') return { data: PHASE_CURRENT };
      throw new Error(`unexpected ${path}`);
    });
    const client = fakeClient({ get: get as CliApiClient['get'] });

    const result = await runReview({ client, idOrPrefix: APV_GATE_PENDING.id });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const statuses = result.approval.artifacts.map((a) => a.syncStatus);
    expect(statuses).toEqual(['notion_only', 'missing']);
  });

  it('없는 승인 건이면 not_found', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const result = await runReview({ client, idOrPrefix: 'zzzzzzzz' });
    expect(result).toEqual({ ok: false, reason: 'not_found', id: 'zzzzzzzz' });
  });

  it('APPROVAL_NOT_FOUND(상세 조회 실패)면 not_found', async () => {
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_GATE_PENDING] };
      throw new ApiRequestError(404, ErrorCode.APPROVAL_NOT_FOUND, '없음');
    });
    const client = fakeClient({ get: get as CliApiClient['get'] });
    const result = await runReview({ client, idOrPrefix: APV_GATE_PENDING.id });
    expect(result).toEqual({ ok: false, reason: 'not_found', id: APV_GATE_PENDING.id });
  });
});

describe('runDecide', () => {
  it('사유 없는 반려는 서버 호출 전에 막는다', async () => {
    const get = vi.fn();
    const post = vi.fn();
    const client = fakeClient({ get, post });

    const result = await runDecide({
      client,
      idOrPrefix: APV_CHOICE_PENDING.id,
      decision: 'reject',
    });

    expect(result).toEqual({ ok: false, reason: 'reason_required' });
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('승인 성공 — Agent 재개 + APV-GATE면 다음 단계명을 돌려준다', async () => {
    const resolved = detailOf(APV_GATE_PENDING, {
      status: 'approved',
      resolution: 'A',
      resolvedAt: '2026-09-01T02:00:00.000Z',
    });
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_GATE_PENDING] };
      if (path === '/phases/current') return { data: PHASE_CURRENT };
      throw new Error(`unexpected ${path}`);
    });
    const post = routed((path, body) => {
      expect(path).toBe(`/approvals/${APV_GATE_PENDING.id}/resolve`);
      expect(body).toEqual({ status: 'approved', resolution: null, reason: null });
      return { data: resolved };
    });
    const client = fakeClient({
      get: get as CliApiClient['get'],
      post: post as CliApiClient['post'],
    });

    const result = await runDecide({
      client,
      idOrPrefix: APV_GATE_PENDING.id,
      decision: 'approve',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.approval.status).toBe('approved');
    expect(result.nextStageSkill).toBe('analyze');
  });

  it('반려 성공 — resolution·reason을 그대로 싣는다', async () => {
    const resolved = detailOf(APV_CHOICE_PENDING, {
      status: 'rejected',
      resolution: 'B',
      reason: '근거 부족',
      resolvedAt: '2026-09-01T02:00:00.000Z',
    });
    const get = vi.fn().mockResolvedValue({ data: [APV_CHOICE_PENDING] });
    const post = routed((_path, body) => {
      expect(body).toEqual({ status: 'rejected', resolution: 'B', reason: '근거 부족' });
      return { data: resolved };
    });
    const client = fakeClient({ get, post: post as CliApiClient['post'] });

    const result = await runDecide({
      client,
      idOrPrefix: APV_CHOICE_PENDING.id,
      decision: 'reject',
      resolution: 'B',
      reason: '근거 부족',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.approval.status).toBe('rejected');
    expect(result.nextStageSkill).toBeUndefined();
  });

  it('없는 resolution 코드면 validation', async () => {
    const get = vi.fn().mockResolvedValue({ data: [APV_CHOICE_PENDING] });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(400, ErrorCode.VALIDATION_ERROR, '옵션에 없는 코드'));
    const client = fakeClient({ get, post });

    const result = await runDecide({
      client,
      idOrPrefix: APV_CHOICE_PENDING.id,
      decision: 'approve',
      resolution: 'Z',
    });

    expect(result).toEqual({ ok: false, reason: 'validation', message: '옵션에 없는 코드' });
  });

  it('이미 처리된 건이면 already_resolved + 기존 결정을 조회한다', async () => {
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_RESOLVED] };
      if (path === `/approvals/${APV_RESOLVED.id}`) return { data: detailOf(APV_RESOLVED) };
      throw new Error(`unexpected ${path}`);
    });
    const post = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(409, ErrorCode.APPROVAL_ALREADY_RESOLVED, '이미 처리됨'),
      );
    const client = fakeClient({ get: get as CliApiClient['get'], post });

    const result = await runDecide({ client, idOrPrefix: APV_RESOLVED.id, decision: 'approve' });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('already_resolved');
    if (result.reason !== 'already_resolved') throw new Error('unreachable');
    expect(result.existing?.status).toBe('approved');
  });

  it('없는 승인 건이면 not_found', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const result = await runDecide({ client, idOrPrefix: 'zzzzzzzz', decision: 'approve' });
    expect(result).toEqual({ ok: false, reason: 'not_found', id: 'zzzzzzzz' });
  });

  it('APPROVAL_REASON_REQUIRED(서버 재확인)면 reason_required', async () => {
    const get = vi.fn().mockResolvedValue({ data: [APV_CHOICE_PENDING] });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(400, ErrorCode.APPROVAL_REASON_REQUIRED, '사유 필요'));
    const client = fakeClient({ get, post });

    // reason을 실었지만(예: 공백 문자열이 서버 검증에서 걸린 경우) 서버가 여전히
    // 거부하는 경로 — CLI 사전 차단과 서버 응답 매핑이 별개임을 확인한다.
    const result = await runDecide({
      client,
      idOrPrefix: APV_CHOICE_PENDING.id,
      decision: 'reject',
      reason: ' ',
    });

    expect(result).toEqual({ ok: false, reason: 'reason_required' });
  });
});

describe('registerApprovalCommand — 출력·종료 코드', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-approval-test-'));
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
    const deps = {
      createClient: () => client,
      homeDir,
      log: (msg: string) => logs.push(msg),
      errorLog: (msg: string) => errors.push(msg),
      setExitCode: (code: number) => {
        exitCode = code;
      },
    };
    registerApprovalCommand(program, deps);

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

    await program.parseAsync(['inbox'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('cm auth login');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('cm inbox — 대기 건이 없으면 안내 문구', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['inbox'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('대기 중인 의사결정이 없습니다');
  });

  it('cm inbox — 높음 등급 존재 시 무기한 경고블록', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: [APV_GATE_PENDING] }),
    });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['inbox'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('무기한 대기');
    expect(logs.join('\n')).toContain('cm review');
  });

  it('cm approvals --pending / --resolved — 필터가 출력 하단에 표시된다', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: [APV_RESOLVED] }),
    });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['approvals', '--resolved'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('resolved');
  });

  it('cm review <id> — options·artifacts·rationale·impact를 전부 출력한다', async () => {
    const detail = detailOf(APV_GATE_PENDING);
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_GATE_PENDING] };
      if (path === `/approvals/${APV_GATE_PENDING.id}`) return { data: detail };
      if (path === '/phases/current') return { data: PHASE_CURRENT };
      throw new Error(`unexpected ${path}`);
    });
    const client = fakeClient({ get: get as CliApiClient['get'] });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['review', APV_GATE_PENDING.id], { from: 'user' });

    const out = logs.join('\n');
    expect(getExitCode()).toBe(0);
    expect(out).toContain('선택지');
    expect(out).toContain('산출물');
    expect(out).toContain('근거');
    expect(out).toContain('영향 범위');
    expect(out).toContain('synced');
    expect(out).toContain('cm decide');
  });

  it('cm review <id> — notion_only 산출물이 있으면 동기화 누락 경고블록', async () => {
    const detail = detailOf(APV_GATE_PENDING, {
      artifacts: [
        {
          code: 'PLN-001',
          title: '요구사항 정의서',
          notionUrl: 'https://app.notion.com/p/plan1',
          gitPath: null,
          syncStatus: 'notion_only',
        },
      ],
    });
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_GATE_PENDING] };
      if (path === `/approvals/${APV_GATE_PENDING.id}`) return { data: detail };
      if (path === '/phases/current') return { data: PHASE_CURRENT };
      throw new Error(`unexpected ${path}`);
    });
    const client = fakeClient({ get: get as CliApiClient['get'] });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['review', APV_GATE_PENDING.id], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('프로세스 위반이 아닙니다');
  });

  it('cm review <없는id> — not_found', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['review', 'zzzzzzzz'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('찾을 수 없습니다');
  });

  it('cm decide <id> --approve --reject — 동시 지정은 서버 호출 없이 차단', async () => {
    const get = vi.fn();
    const post = vi.fn();
    const client = fakeClient({ get, post });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['decide', APV_GATE_PENDING.id, '--approve', '--reject'], {
      from: 'user',
    });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('동시에 지정할 수 없습니다');
    expect(get).not.toHaveBeenCalled();
  });

  it('cm decide <id> (플래그 없음) — 사용법 안내 후 exit 1', async () => {
    const client = fakeClient();
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['decide', APV_GATE_PENDING.id], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('--approve 또는 --reject');
  });

  it('cm decide <id> --reject (사유 없음) — exit 1, 서버 호출 없음', async () => {
    const get = vi.fn();
    const post = vi.fn();
    const client = fakeClient({ get, post });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['decide', APV_GATE_PENDING.id, '--reject'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('사유가 필요합니다');
    expect(get).not.toHaveBeenCalled();
  });

  it('cm decide <id> --approve — 승인 완료 + Agent 재개 + 다음 단계 안내', async () => {
    const resolved = detailOf(APV_GATE_PENDING, {
      status: 'approved',
      resolution: 'A',
      resolvedAt: '2026-09-01T02:00:00.000Z',
    });
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_GATE_PENDING] };
      if (path === '/phases/current') return { data: PHASE_CURRENT };
      throw new Error(`unexpected ${path}`);
    });
    const post = vi.fn().mockResolvedValue({ data: resolved });
    const client = fakeClient({ get: get as CliApiClient['get'], post });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['decide', APV_GATE_PENDING.id, '--approve'], { from: 'user' });

    const out = logs.join('\n');
    expect(getExitCode()).toBe(0);
    expect(out).toContain('승인 완료');
    expect(out).toContain('재개');
    expect(out).toContain('다음 단계: analyze');
    expect(out).toContain('cm stage start analyze');
  });

  it('cm decide <id> --reject --reason — 반려 완료 + "대기 상태를 유지"', async () => {
    const resolved = detailOf(APV_CHOICE_PENDING, {
      status: 'rejected',
      reason: '근거 부족',
      resolvedAt: '2026-09-01T02:00:00.000Z',
    });
    const get = vi.fn().mockResolvedValue({ data: [APV_CHOICE_PENDING] });
    const post = vi.fn().mockResolvedValue({ data: resolved });
    const client = fakeClient({ get, post });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(
      ['decide', APV_CHOICE_PENDING.id, '--reject', '--reason', '근거 부족'],
      { from: 'user' },
    );

    const out = logs.join('\n');
    expect(getExitCode()).toBe(0);
    expect(out).toContain('반려 완료');
    expect(out).toContain('대기 상태를 유지합니다');
    expect(out).not.toContain('다음 단계');
  });

  it('cm decide <id> --approve — APPROVAL_ALREADY_RESOLVED', async () => {
    const get = routed((path) => {
      if (path === '/approvals') return { data: [APV_RESOLVED] };
      if (path === `/approvals/${APV_RESOLVED.id}`) return { data: detailOf(APV_RESOLVED) };
      throw new Error(`unexpected ${path}`);
    });
    const post = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(409, ErrorCode.APPROVAL_ALREADY_RESOLVED, '이미 처리됨'),
      );
    const client = fakeClient({ get: get as CliApiClient['get'], post });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['decide', APV_RESOLVED.id, '--approve'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('이미 처리된 승인 건입니다');
  });

  it('cm decide <없는id> --approve — APPROVAL_NOT_FOUND', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['decide', 'zzzzzzzz', '--approve'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('찾을 수 없습니다');
  });

  it('서버 unreachable이면 exit 1', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['inbox'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('서버에 연결할 수 없습니다');
  });

  it('inbox·decide·approvals·review가 최상위 명령으로 등록된다', () => {
    const { program } = buildTestProgram(fakeClient());
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['inbox', 'decide', 'approvals', 'review']));
  });
});
