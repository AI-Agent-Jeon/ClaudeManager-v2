import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, ServerUnreachableError } from '../../../../src/cli/api-client.js';
import { createProgram } from '../../../../src/cli/commands/auth.js';
import {
  registerProgressCommand,
  runArtifacts,
  runProgress,
  runProgressWaive,
  runStageComplete,
  runStageStart,
} from '../../../../src/cli/commands/progress.js';
import { saveAuth } from '../../../../src/cli/config.js';
import type { CliApiClient } from '../../../../src/cli/runtime.js';
import { ErrorCode } from '../../../../src/shared/constants.js';
import type { PhaseCurrent, StageSummary } from '../../../../src/shared/types.js';

/** `registerProgressCommand` 출력 테스트 전용 — approval.test.ts와 같은 인증 픽스처 */
let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-progress-test-'));
  saveAuth({ token: 't', expiresAt: '2099-01-01T00:00:00.000Z' }, homeDir);
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

/**
 * `cm progress` / `cm stage start|complete <skill>` / `cm artifacts` — 수용 기준
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-CH06·09·14·10 · §4-5 "진행" EVT-CH06·09·14·10
 *
 * 그룹 A·B·C와 같은 관용구 — `run*` 판정 로직은 `fakeClient`로 검증하고,
 * `registerProgressCommand`는 `createProgram()`(commander v14 고정)으로
 * 이중 설치 함정을 우회한다. 3단 가드 실패 3종(EVT-CH09-2·3·4)의 안내
 * 문구가 이 그룹의 핵심 회귀 테스트다(개발 지시 §6).
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

function routed(
  handler: (path: string, body?: unknown) => unknown,
): (path: string, body?: unknown) => Promise<unknown> {
  return vi.fn((path: string, body?: unknown) =>
    Promise.resolve(handler(path, body)),
  ) as unknown as (path: string, body?: unknown) => Promise<unknown>;
}

const SKILLS = ['plan', 'analyze', 'design', 'develop', 'test', 'deploy', 'operate'] as const;

function makeStage(skill: string, overrides: Partial<StageSummary> = {}): StageSummary {
  const required = skill === 'plan' || skill === 'test';
  return {
    id: `stage-${skill}`,
    skill: skill as StageSummary['skill'],
    status: 'pending',
    startedAt: null,
    completedAt: null,
    artifactCount: 0,
    pendingApprovalCount: 0,
    gate: { required, approvalId: null, passed: false },
    ...overrides,
  };
}

function basePhaseCurrent(overrides: Partial<PhaseCurrent> = {}): PhaseCurrent {
  return {
    phase: { id: 'phase-1', number: 1, name: '기반 구축', currentStage: 'plan' },
    stages: SKILLS.map((s) => makeStage(s)),
    wipViolations: [],
    ...overrides,
  };
}

/** 특정 스킬의 단계 하나만 덮어쓴 새 PhaseCurrent를 만든다 */
function withStage(
  phaseCurrent: PhaseCurrent,
  skill: string,
  overrides: Partial<StageSummary>,
): PhaseCurrent {
  return {
    ...phaseCurrent,
    stages: phaseCurrent.stages.map((s) => (s.skill === skill ? { ...s, ...overrides } : s)),
  };
}

// ─────────────────────────────────────────────
// runProgress
// ─────────────────────────────────────────────

describe('runProgress', () => {
  it('현재 Phase를 그대로 돌려준다', async () => {
    const data = basePhaseCurrent();
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data }) });

    const result = await runProgress({ client });

    expect(result).toEqual({ ok: true, data });
  });

  it('진행 중 Phase가 없으면 no_phase (404 NOT_FOUND)', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.NOT_FOUND, '없음')),
    });
    const result = await runProgress({ client });
    expect(result).toEqual({ ok: false, reason: 'no_phase' });
  });

  it('서버 unreachable이면 server_unreachable', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });
    const result = await runProgress({ client });
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
    const result = await runProgress({ client });
    expect(result).toEqual({ ok: false, reason: 'unauthenticated' });
  });
});

// ─────────────────────────────────────────────
// registerProgressCommand — cm progress 출력
// ─────────────────────────────────────────────

describe('registerProgressCommand — cm progress', () => {
  function buildTestProgram(client: CliApiClient) {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | undefined;

    const program = createProgram();
    program.exitOverride();
    const deps = {
      createClient: () => client,
      homeDir,
      now: () => new Date('2026-09-02T00:00:00.000Z'),
      log: (msg: string) => logs.push(msg),
      errorLog: (msg: string) => errors.push(msg),
      setExitCode: (code: number) => {
        exitCode = code;
      },
    };
    registerProgressCommand(program, deps);
    return { program, logs, errors, getExitCode: () => exitCode };
  }

  it('7단계 보드 + 현재 단계를 출력한다 (EVT-CH06-1)', async () => {
    const data = basePhaseCurrent({
      phase: { id: 'phase-1', number: 1, name: '기반 구축', currentStage: 'analyze' },
      stages: SKILLS.map((s) =>
        makeStage(
          s,
          s === 'plan'
            ? {
                status: 'completed',
                gate: { required: true, approvalId: 'apv-plan', passed: true },
              }
            : {},
        ),
      ),
    });
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data }) });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['progress'], { from: 'user' });

    const out = logs.join('\n');
    expect(getExitCode()).toBe(0);
    expect(out).toContain('Phase 1: 기반 구축');
    expect(out).toContain('현재 단계: analyze');
    expect(out).toContain('plan');
    expect(out).toContain('develop');
  });

  it('WIP 위반이 없으면 위반 블록을 출력하지 않는다', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: basePhaseCurrent() }) });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['progress'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).not.toContain('WIP 위반');
  });

  it('WIP 위반이 있고 면제가 없으면 조치 명령을 안내한다 (EVT-CH06-2)', async () => {
    const data = basePhaseCurrent({
      wipViolations: [
        {
          rule: '주요 단계 WIP = 1',
          detail: 'design과 develop이 동시에 in_progress',
          waived: false,
        },
      ],
    });
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data }) });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['progress'], { from: 'user' });

    const out = logs.join('\n');
    expect(getExitCode()).toBe(0);
    expect(out).toContain('WIP 위반 (1)');
    expect(out).toContain('cm progress --waive');
    expect(out).not.toContain('(면제됨)');
  });

  it('WIP 위반이 면제됐어도 위반 자체는 계속 보고한다 (개발 지시 §3(1) — 감춤 금지)', async () => {
    const data = basePhaseCurrent({
      wipViolations: [
        {
          rule: '주요 단계 WIP = 1',
          detail: 'design과 develop이 동시에 in_progress',
          waived: true,
        },
      ],
    });
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data }) });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['progress'], { from: 'user' });

    const out = logs.join('\n');
    expect(getExitCode()).toBe(0);
    expect(out).toContain('WIP 위반 (1)');
    expect(out).toContain('(면제됨)');
    expect(out).not.toContain('cm progress --waive "<사유>"');
  });

  it('게이트 필요 단계가 미통과면 경고블록을 출력한다 (EVT-CH06-3)', async () => {
    const data = basePhaseCurrent(); // plan은 gate.required=true, passed=false(기본값)
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data }) });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['progress'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('plan → analyze 게이트가 통과된 기록이 없습니다');
  });

  it('진행 중인 Phase가 없으면 exit 1', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.NOT_FOUND, '없음')),
    });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['progress'], { from: 'user' });

    expect(getExitCode()).toBe(1);
    expect(errors.join('\n')).toContain('진행 중인 Phase가 없습니다');
  });
});

// ─────────────────────────────────────────────
// cm progress --waive
// ─────────────────────────────────────────────

describe('runProgressWaive', () => {
  it('사유가 없으면 서버 호출 전에 막는다', async () => {
    const get = vi.fn();
    const post = vi.fn();
    const client = fakeClient({ get, post });

    const result = await runProgressWaive({ client, reasonInput: '   ' });

    expect(result).toEqual({ ok: false, reason: 'empty_reason' });
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('성공 — phaseId·rule·reason을 실어 POST /api/wip-waivers를 호출한다', async () => {
    const data = basePhaseCurrent();
    const get = vi.fn().mockResolvedValue({ data });
    const post = routed((path, body) => {
      expect(path).toBe('/wip-waivers');
      expect(body).toEqual({ phaseId: 'phase-1', rule: '주요 단계 WIP = 1', reason: '병행 필요' });
      return { data: null };
    });
    const client = fakeClient({ get, post: post as CliApiClient['post'] });

    const result = await runProgressWaive({ client, reasonInput: '병행 필요' });

    expect(result).toEqual({ ok: true, phaseName: '기반 구축', reason: '병행 필요' });
  });

  it('진행 중 Phase가 없으면 no_phase', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.NOT_FOUND, '없음')),
    });
    const result = await runProgressWaive({ client, reasonInput: '사유' });
    expect(result).toEqual({ ok: false, reason: 'no_phase' });
  });

  it('서버 검증 실패(reason 공백 등)는 validation으로 매핑한다', async () => {
    const get = vi.fn().mockResolvedValue({ data: basePhaseCurrent() });
    const post = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(400, ErrorCode.VALIDATION_ERROR, 'reason은 빈 문자열일 수 없습니다'),
      );
    const client = fakeClient({ get, post });

    const result = await runProgressWaive({ client, reasonInput: '사유' });

    expect(result).toEqual({
      ok: false,
      reason: 'validation',
      message: 'reason은 빈 문자열일 수 없습니다',
    });
  });
});

// ─────────────────────────────────────────────
// cm stage start — 3단 가드 (이 그룹의 핵심 회귀)
// ─────────────────────────────────────────────

describe('runStageStart', () => {
  it('알 수 없는 스킬명은 서버 호출 전에 막는다', async () => {
    const get = vi.fn();
    const client = fakeClient({ get });

    const result = await runStageStart({ client, skill: 'deploy-now' });

    expect(result).toEqual({ ok: false, reason: 'invalid_skill', skill: 'deploy-now' });
    expect(get).not.toHaveBeenCalled();
  });

  it('성공 — 대상·직전 단계·착수 결과를 돌려준다', async () => {
    const before = basePhaseCurrent({
      stages: SKILLS.map((s) =>
        makeStage(
          s,
          s === 'plan' ? { status: 'completed', completedAt: '2026-08-11T00:00:00.000Z' } : {},
        ),
      ),
    });
    const afterSummary: StageSummary = {
      ...makeStage('analyze'),
      status: 'in_progress',
      startedAt: '2026-09-01T10:00:00.000Z',
    };
    const get = vi.fn().mockResolvedValue({ data: before });
    const post = routed((path) => {
      expect(path).toBe('/stages/stage-analyze/start');
      return { data: afterSummary };
    });
    const client = fakeClient({ get, post: post as CliApiClient['post'] });

    const result = await runStageStart({ client, skill: 'analyze' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.after.status).toBe('in_progress');
    expect(result.precedingStage?.skill).toBe('plan');
  });

  it('게이트 미통과 — 필요한 승인 ID를 스냅숏에서 채운다 (EVT-CH09-2)', async () => {
    const data = withStage(basePhaseCurrent(), 'plan', {
      gate: { required: true, approvalId: 'apv-plan-1', passed: false },
    });
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(403, ErrorCode.GATE_NOT_PASSED, '게이트 미통과'));
    const client = fakeClient({ get, post });

    const result = await runStageStart({ client, skill: 'plan' });

    expect(result).toEqual({ ok: false, reason: 'gate_not_passed', approvalId: 'apv-plan-1' });
  });

  it('게이트 미통과인데 상정된 승인 건 자체가 없으면 approvalId는 null', async () => {
    const data = basePhaseCurrent(); // plan.gate.approvalId 기본값 null
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(403, ErrorCode.GATE_NOT_PASSED, '게이트 미통과'));
    const client = fakeClient({ get, post });

    const result = await runStageStart({ client, skill: 'plan' });

    expect(result).toEqual({ ok: false, reason: 'gate_not_passed', approvalId: null });
  });

  it('직전 단계 미완료 — 직전 단계명·상태를 스냅숏에서 채운다 (EVT-CH09-3)', async () => {
    const data = basePhaseCurrent(); // plan은 기본 pending → design의 직전(analyze)도 pending
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '직전 단계 미완료'),
      );
    const client = fakeClient({ get, post });

    const result = await runStageStart({ client, skill: 'design' });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_transition',
      precedingSkill: 'analyze',
      precedingStatus: 'pending',
    });
  });

  it('대상 단계 자신이 이미 진행 중/완료면 selfStatus로 구분한다', async () => {
    const data = withStage(basePhaseCurrent(), 'analyze', { status: 'in_progress' });
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '이미 진행 중'));
    const client = fakeClient({ get, post });

    const result = await runStageStart({ client, skill: 'analyze' });

    expect(result).toEqual({ ok: false, reason: 'invalid_transition', selfStatus: 'in_progress' });
  });

  it('WIP 위반 — 진행 중인 다른 단계명을 스냅숏에서 채운다 (EVT-CH09-4)', async () => {
    const data = withStage(basePhaseCurrent(), 'design', { status: 'in_progress' });
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(409, ErrorCode.WIP_VIOLATION, 'WIP 위반'));
    const client = fakeClient({ get, post });

    const result = await runStageStart({ client, skill: 'develop' });

    expect(result).toEqual({ ok: false, reason: 'wip_violation', inProgressSkill: 'design' });
  });

  it('STAGE_NOT_FOUND면 stage_not_found', async () => {
    const get = vi.fn().mockResolvedValue({ data: basePhaseCurrent() });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(404, ErrorCode.STAGE_NOT_FOUND, '없음'));
    const client = fakeClient({ get, post });

    const result = await runStageStart({ client, skill: 'analyze' });

    expect(result).toEqual({ ok: false, reason: 'stage_not_found', id: 'stage-analyze' });
  });

  it('진행 중인 Phase가 없으면 no_phase', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ApiRequestError(404, ErrorCode.NOT_FOUND, '없음')),
    });
    const result = await runStageStart({ client, skill: 'analyze' });
    expect(result).toEqual({ ok: false, reason: 'no_phase' });
  });
});

// ─────────────────────────────────────────────
// cm stage start — 출력 (안내 문구까지 확인 — 이 그룹의 핵심)
// ─────────────────────────────────────────────

describe('registerProgressCommand — cm stage start 출력', () => {
  function buildTestProgram(client: CliApiClient) {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | undefined;
    const program = createProgram();
    program.exitOverride();
    registerProgressCommand(program, {
      createClient: () => client,
      homeDir,
      log: (msg: string) => logs.push(msg),
      errorLog: (msg: string) => errors.push(msg),
      setExitCode: (code: number) => {
        exitCode = code;
      },
    });
    return { program, logs, errors, getExitCode: () => exitCode };
  }

  it('성공 — 착수 결과와 시각을 출력한다', async () => {
    const before = basePhaseCurrent({
      stages: SKILLS.map((s) => makeStage(s, s === 'plan' ? { status: 'completed' } : {})),
    });
    const after: StageSummary = {
      ...makeStage('analyze'),
      status: 'in_progress',
      startedAt: '2026-09-01T10:00:00.000Z',
    };
    const get = vi.fn().mockResolvedValue({ data: before });
    const post = vi.fn().mockResolvedValue({ data: after });
    const client = fakeClient({ get, post });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['stage', 'start', 'analyze'], { from: 'user' });

    const out = logs.join('\n');
    expect(getExitCode()).toBe(0);
    expect(out).toContain('단계 착수');
    expect(out).toContain('pending → in_progress');
  });

  it('GATE_NOT_PASSED — 필요한 승인 ID와 cm review 안내가 실제로 출력된다', async () => {
    const data = withStage(basePhaseCurrent(), 'plan', {
      gate: { required: true, approvalId: 'apv12345-0000-0000-0000-000000000000', passed: false },
    });
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(403, ErrorCode.GATE_NOT_PASSED, '게이트 미통과'));
    const client = fakeClient({ get, post });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['stage', 'start', 'plan'], { from: 'user' });

    const out = errors.join('\n');
    expect(getExitCode()).toBe(1);
    expect(out).toContain('필요한 승인 ID: apv12345');
    expect(out).toContain('cm review apv12345');
  });

  it('INVALID_TRANSITION — 직전 단계명과 현재 상태가 실제로 출력된다', async () => {
    const data = basePhaseCurrent();
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '직전 단계 미완료'),
      );
    const client = fakeClient({ get, post });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['stage', 'start', 'design'], { from: 'user' });

    const out = errors.join('\n');
    expect(getExitCode()).toBe(1);
    expect(out).toContain('직전 단계: analyze (대기)');
    // 직전 단계가 아직 pending이면 "start"를 권해야 한다 — "complete"를 권하면
    // 그 자체가 또 INVALID_TRANSITION이 난다(실사용 검증에서 발견한 버그, §완료
    // 판정 기준 5).
    expect(out).toContain('cm stage start analyze');
    expect(out).not.toContain('cm stage complete analyze');
  });

  it('INVALID_TRANSITION — 직전 단계가 in_progress면 "complete"를 권한다', async () => {
    const data = withStage(basePhaseCurrent(), 'analyze', { status: 'in_progress' });
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(
        new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '직전 단계 미완료'),
      );
    const client = fakeClient({ get, post });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['stage', 'start', 'design'], { from: 'user' });

    const out = errors.join('\n');
    expect(getExitCode()).toBe(1);
    expect(out).toContain('직전 단계: analyze (진행)');
    expect(out).toContain('cm stage complete analyze');
  });

  it('WIP_VIOLATION — 진행 중 단계명과 --waive 안내가 실제로 출력된다', async () => {
    const data = withStage(basePhaseCurrent(), 'design', { status: 'in_progress' });
    const get = vi.fn().mockResolvedValue({ data });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(409, ErrorCode.WIP_VIOLATION, 'WIP 위반'));
    const client = fakeClient({ get, post });
    const { program, errors, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['stage', 'start', 'develop'], { from: 'user' });

    const out = errors.join('\n');
    expect(getExitCode()).toBe(1);
    expect(out).toContain('진행 중 단계: design');
    expect(out).toContain('cm progress --waive');
  });
});

// ─────────────────────────────────────────────
// cm stage complete
// ─────────────────────────────────────────────

describe('runStageComplete', () => {
  it('성공', async () => {
    const before = basePhaseCurrent({
      stages: SKILLS.map((s) => makeStage(s, s === 'analyze' ? { status: 'in_progress' } : {})),
    });
    const after: StageSummary = {
      ...makeStage('analyze'),
      status: 'completed',
      completedAt: '2026-09-01T12:00:00.000Z',
    };
    const get = vi.fn().mockResolvedValue({ data: before });
    const post = routed((path) => {
      expect(path).toBe('/stages/stage-analyze/complete');
      return { data: after };
    });
    const client = fakeClient({ get, post: post as CliApiClient['post'] });

    const result = await runStageComplete({ client, skill: 'analyze' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.after.status).toBe('completed');
  });

  it('pending 단계는 422 INVALID_TRANSITION으로 거부된다', async () => {
    const get = vi.fn().mockResolvedValue({ data: basePhaseCurrent() });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(422, ErrorCode.INVALID_TRANSITION, '진행 중 아님'));
    const client = fakeClient({ get, post });

    const result = await runStageComplete({ client, skill: 'analyze' });

    expect(result).toEqual({ ok: false, reason: 'invalid_transition', status: 'pending' });
  });

  it('없는 단계는 404 STAGE_NOT_FOUND', async () => {
    const get = vi.fn().mockResolvedValue({ data: basePhaseCurrent() });
    const post = vi
      .fn()
      .mockRejectedValue(new ApiRequestError(404, ErrorCode.STAGE_NOT_FOUND, '없음'));
    const client = fakeClient({ get, post });

    const result = await runStageComplete({ client, skill: 'analyze' });

    expect(result).toEqual({ ok: false, reason: 'stage_not_found', id: 'stage-analyze' });
  });

  it('알 수 없는 스킬명은 서버 호출 전에 막는다', async () => {
    const get = vi.fn();
    const client = fakeClient({ get });
    const result = await runStageComplete({ client, skill: 'foo' });
    expect(result).toEqual({ ok: false, reason: 'invalid_skill', skill: 'foo' });
    expect(get).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────
// 플로우 통합 — stage start → stage complete → 다음 단계 start
// ─────────────────────────────────────────────

describe('플로우 통합 — start → complete → 다음 start', () => {
  it('analyze 착수 → 완료 → design 착수가 이어진다', async () => {
    // 서버 상태를 흉내내는 간단한 인메모리 픽스처. analyze는 gate.required=false라
    // 이 시나리오에서 게이트를 신경 쓰지 않는다(plan은 이미 completed로 시작).
    let state = basePhaseCurrent({
      stages: SKILLS.map((s) => makeStage(s, s === 'plan' ? { status: 'completed' } : {})),
    });

    const client = fakeClient({
      get: vi.fn(() => Promise.resolve({ data: state })) as unknown as CliApiClient['get'],
      post: vi.fn((path: string) => {
        const match = /^\/stages\/(stage-\w+)\/(start|complete)$/.exec(path);
        if (!match) return Promise.reject(new Error(`unexpected path: ${path}`));
        const [, stageId, action] = match;
        const nextStatus = action === 'start' ? 'in_progress' : 'completed';
        const timeField = action === 'start' ? 'startedAt' : 'completedAt';
        state = {
          ...state,
          stages: state.stages.map((s) =>
            s.id === stageId
              ? {
                  ...s,
                  status: nextStatus as StageSummary['status'],
                  [timeField]: '2026-09-01T10:00:00.000Z',
                }
              : s,
          ),
        };
        const updated = state.stages.find((s) => s.id === stageId) as StageSummary;
        return Promise.resolve({ data: updated });
      }) as unknown as CliApiClient['post'],
    });

    const start1 = await runStageStart({ client, skill: 'analyze' });
    expect(start1.ok).toBe(true);
    if (!start1.ok) throw new Error('unreachable');
    expect(start1.after.status).toBe('in_progress');

    const complete1 = await runStageComplete({ client, skill: 'analyze' });
    expect(complete1.ok).toBe(true);
    if (!complete1.ok) throw new Error('unreachable');
    expect(complete1.after.status).toBe('completed');

    const start2 = await runStageStart({ client, skill: 'design' });
    expect(start2.ok).toBe(true);
    if (!start2.ok) throw new Error('unreachable');
    expect(start2.after.status).toBe('in_progress');
  });
});

// ─────────────────────────────────────────────
// cm artifacts
// ─────────────────────────────────────────────

const ARTIFACT_SYNCED = {
  id: 'art-1',
  code: 'PLN-001',
  title: '요구사항 정의서',
  status: 'approved',
  notionUrl: 'https://app.notion.com/p/plan1',
  gitPath: 'docs/requirements/pln-001-requirements.md',
  syncStatus: 'synced',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const ARTIFACT_NOTION_ONLY = {
  ...ARTIFACT_SYNCED,
  id: 'art-2',
  code: 'ANL-001',
  gitPath: null,
  syncStatus: 'notion_only',
};

const ARTIFACT_MISSING = {
  ...ARTIFACT_SYNCED,
  id: 'art-3',
  code: 'DES-999',
  notionUrl: null,
  gitPath: null,
  syncStatus: 'missing',
};

describe('runArtifacts', () => {
  it('필터 없이 전건 조회한다', async () => {
    const get = routed((path) => {
      expect(path).toBe('/artifacts');
      return { data: [ARTIFACT_SYNCED, ARTIFACT_NOTION_ONLY] };
    });
    const client = fakeClient({ get: get as CliApiClient['get'] });

    const result = await runArtifacts({ client });

    expect(result).toEqual({
      ok: true,
      items: [ARTIFACT_SYNCED, ARTIFACT_NOTION_ONLY],
      sync: undefined,
    });
  });

  it.each(['synced', 'notion_only', 'git_only', 'missing'])(
    '--sync %s는 서버 쿼리로 전달된다',
    async (sync) => {
      const get = routed((path) => {
        expect(path).toBe(`/artifacts?syncStatus=${sync}`);
        return { data: [] };
      });
      const client = fakeClient({ get: get as CliApiClient['get'] });

      const result = await runArtifacts({ client, sync });

      expect(result).toEqual({ ok: true, items: [], sync });
    },
  );

  it('알 수 없는 동기화 상태는 서버 호출 전에 막는다', async () => {
    const get = vi.fn();
    const client = fakeClient({ get });

    const result = await runArtifacts({ client, sync: 'nonsense' });

    expect(result).toEqual({ ok: false, reason: 'invalid_sync', value: 'nonsense' });
    expect(get).not.toHaveBeenCalled();
  });

  it('서버 unreachable이면 exit 1', async () => {
    const client = fakeClient({
      get: vi.fn().mockRejectedValue(new ServerUnreachableError('http://127.0.0.1:3000/api')),
    });
    const result = await runArtifacts({ client });
    expect(result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      serverUrl: 'http://127.0.0.1:3000/api',
    });
  });
});

describe('registerProgressCommand — cm artifacts 출력', () => {
  function buildTestProgram(client: CliApiClient) {
    const logs: string[] = [];
    const errors: string[] = [];
    let exitCode: number | undefined;
    const program = createProgram();
    program.exitOverride();
    registerProgressCommand(program, {
      createClient: () => client,
      homeDir,
      log: (msg: string) => logs.push(msg),
      errorLog: (msg: string) => errors.push(msg),
      setExitCode: (code: number) => {
        exitCode = code;
      },
    });
    return { program, logs, errors, getExitCode: () => exitCode };
  }

  it('notion_only·missing이 서로 다르게 표시된다 (FR-031 핵심 — 2026-09-01 오진단 재발 방지)', async () => {
    const client = fakeClient({
      get: vi.fn().mockResolvedValue({ data: [ARTIFACT_NOTION_ONLY, ARTIFACT_MISSING] }),
    });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['artifacts'], { from: 'user' });

    const out = logs.join('\n');
    expect(getExitCode()).toBe(0);
    expect(out).toContain('notion_only');
    expect(out).toContain('missing');
    expect(out).toContain('동기화 누락이지 프로세스 위반이 아닙니다');
  });

  it('산출물이 없으면 안내 문구', async () => {
    const client = fakeClient({ get: vi.fn().mockResolvedValue({ data: [] }) });
    const { program, logs, getExitCode } = buildTestProgram(client);

    await program.parseAsync(['artifacts'], { from: 'user' });

    expect(getExitCode()).toBe(0);
    expect(logs.join('\n')).toContain('산출물이 없습니다');
  });
});

// ─────────────────────────────────────────────
// 인증 가드 · 등록
// ─────────────────────────────────────────────

describe('registerProgressCommand — 인증 가드', () => {
  it('인증되지 않았으면 client를 만들기 전에 exit 1', async () => {
    const createClient = vi.fn();
    const errors: string[] = [];
    let exitCode: number | undefined;
    const program = createProgram();
    program.exitOverride();
    registerProgressCommand(program, {
      createClient,
      homeDir: '/nonexistent-home-dir-for-test',
      log: () => {},
      errorLog: (msg: string) => errors.push(msg),
      setExitCode: (code: number) => {
        exitCode = code;
      },
    });

    await program.parseAsync(['progress'], { from: 'user' });

    expect(exitCode).toBe(1);
    expect(errors.join('\n')).toContain('cm auth login');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('progress·stage·artifacts가 등록된다', () => {
    const program = createProgram();
    registerProgressCommand(program, { createClient: () => fakeClient() });
    const names = program.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['progress', 'stage', 'artifacts']));

    const stage = program.commands.find((c) => c.name() === 'stage');
    const subNames = stage?.commands.map((c) => c.name()) ?? [];
    expect(subNames).toEqual(expect.arrayContaining(['start', 'complete']));
  });
});

// `cm --help`의 8개 명령 그룹 전부 등록 확인은 `tests/unit/cli/index.test.ts`가 맡는다
// (buildProgram 자체의 골격 검증 파일 — 중복 검증을 피한다).
