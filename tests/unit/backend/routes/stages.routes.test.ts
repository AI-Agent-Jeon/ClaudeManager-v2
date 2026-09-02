import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';
import { isoNow, seedApproval } from '../../../fixtures/test-db.js';

/**
 * FR-030 — stages.routes (`POST /api/stages/:id/start`)
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5 · DES-004 v2.4 §16 · DES-007 v2.1 §7-1
 *
 * **이것이 CLAUDE.md 스킬 전환 게이트의 유일한 강제 지점이다.** 화면에서 버튼을
 * 감추는 것으로는 강제되지 않고, CLI·API 직접 호출도 이 경로를 지난다 — 그래서
 * 게이트 우회 시도(가드 미승인 상태에서 API 직접 호출)를 별도로 검증한다.
 *
 * 부트스트랩(R-1)은 이 계층(2-8) 범위 밖이라 서버 기동 시 Phase가 시드되지
 * 않는다 — 각 테스트가 `POST /api/phases`로 Phase를 직접 만들고, 다른
 * 라우트 테스트(`agent-delete-atomicity.test.ts` 등)와 같은 방식으로
 * `app.db`에 직접 시드해 선행 조건을 만든다.
 */

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp({
    config: { dbPath: ':memory:', authSecret: 'test-secret', jwtExpiresIn: '7d' },
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { secret: 'test-secret' },
  });
  token = res.json().data.token;
});

afterEach(async () => {
  await app.close();
});

function authHeader() {
  return { authorization: `Bearer ${token}` };
}

interface StageSummaryLike {
  id: string;
  skill: string;
  status: string;
  gate: { required: boolean; approvalId: string | null; passed: boolean };
}

interface PhaseCurrentLike {
  phase: { id: string };
  stages: StageSummaryLike[];
}

async function createPhaseWithStages(number: number): Promise<PhaseCurrentLike> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/phases',
    headers: authHeader(),
    payload: { number, name: '단계 착수 테스트용' },
  });
  return res.json().data as PhaseCurrentLike;
}

function findStage(current: PhaseCurrentLike, skill: string): StageSummaryLike {
  const stage = current.stages.find((s) => s.skill === skill);
  if (!stage) throw new Error(`stage not found: ${skill}`);
  return stage;
}

/** approvals.routes.ts 경유가 아니라 DB에 직접 심는다 — approval.service 경로는 이 계층 범위 밖이다 */
function seedApprovedGate(stageId: string): void {
  seedApproval(app.db, {
    stageId,
    approvalType: 'APV-GATE',
    level: 'high',
    status: 'approved',
    resolvedAt: isoNow(),
  });
}

function seedRejectedGate(stageId: string): void {
  seedApproval(app.db, {
    stageId,
    approvalType: 'APV-GATE',
    level: 'high',
    status: 'rejected',
    reason: '수용 기준 미비',
    resolvedAt: isoNow(),
  });
}

function setStageStatus(stageId: string, status: string): void {
  const now = isoNow();
  app.db
    .prepare(
      "UPDATE stages SET status = ?, started_at = CASE WHEN ? IN ('in_progress','completed') THEN ? ELSE started_at END, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END WHERE id = ?",
    )
    .run(status, status, now, status, now, stageId);
}

async function startStage(stageId: string) {
  return app.inject({
    method: 'POST',
    url: `/api/stages/${stageId}/start`,
    headers: authHeader(),
  });
}

describe('POST /api/stages/:id/start — FR-030 3단 가드', () => {
  it('존재하지 않는 단계 id면 404 STAGE_NOT_FOUND', async () => {
    const res = await startStage(crypto.randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('STAGE_NOT_FOUND');
  });

  it('첫 단계(plan)는 APV-GATE 승인 후 200과 in_progress StageSummary를 반환한다', async () => {
    const current = await createPhaseWithStages(101);
    const plan = findStage(current, 'plan');
    seedApprovedGate(plan.id);

    const res = await startStage(plan.id);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as StageSummaryLike;
    expect(data.status).toBe('in_progress');
    expect(data.gate.passed).toBe(true);
  });

  it('가드 우회 시도 — 게이트 미승인 상태에서 직접 호출해도 403 GATE_NOT_PASSED (FR-030 회귀 방어선)', async () => {
    const current = await createPhaseWithStages(102);
    const plan = findStage(current, 'plan');

    const res = await startStage(plan.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('GATE_NOT_PASSED');
  });

  it('APV-GATE가 반려되면 403 GATE_NOT_PASSED — 우회 재시도로도 뚫리지 않는다', async () => {
    const current = await createPhaseWithStages(103);
    const plan = findStage(current, 'plan');
    seedRejectedGate(plan.id);

    const res = await startStage(plan.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('GATE_NOT_PASSED');
  });

  it('직전 단계가 completed가 아니면 422 INVALID_TRANSITION (analyze를 plan pending 상태에서 착수 시도)', async () => {
    const current = await createPhaseWithStages(104);
    const analyze = findStage(current, 'analyze');

    const res = await startStage(analyze.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_TRANSITION');
  });

  it('게이트 불필요 단계(analyze)는 직전 단계 완료 후 승인 없이 착수된다', async () => {
    const current = await createPhaseWithStages(105);
    const plan = findStage(current, 'plan');
    const analyze = findStage(current, 'analyze');
    setStageStatus(plan.id, 'completed');

    const res = await startStage(analyze.id);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as StageSummaryLike;
    expect(data.status).toBe('in_progress');
    expect(data.gate.required).toBe(false);
  });

  it('WIP=1 위반이면 409 WIP_VIOLATION', async () => {
    const current = await createPhaseWithStages(106);
    const plan = findStage(current, 'plan');
    const analyze = findStage(current, 'analyze');
    const design = findStage(current, 'design');
    // design의 직전 단계(analyze)는 completed로, WIP 위반은 plan을 in_progress로 둬서 만든다
    setStageStatus(plan.id, 'in_progress');
    setStageStatus(analyze.id, 'completed');

    const res = await startStage(design.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('WIP_VIOLATION');
  });

  it('WIP 면제가 등록되어 있으면 200으로 착수된다', async () => {
    const current = await createPhaseWithStages(107);
    const plan = findStage(current, 'plan');
    const analyze = findStage(current, 'analyze');
    const design = findStage(current, 'design');
    setStageStatus(plan.id, 'in_progress');
    setStageStatus(analyze.id, 'completed');
    app.db
      .prepare(
        'INSERT INTO wip_waivers (id, phase_id, rule, reason, created_at) VALUES (?,?,?,?,?)',
      )
      .run(crypto.randomUUID(), current.phase.id, '주요 단계 WIP = 1', '병행 사유', isoNow());

    const res = await startStage(design.id);
    expect(res.statusCode).toBe(200);
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/stages/${crypto.randomUUID()}/start`,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/stages/:id/start — 응답 스키마', () => {
  it('data.gate는 required·approvalId·passed 3필드를 가진다', async () => {
    const current = await createPhaseWithStages(108);
    const plan = findStage(current, 'plan');
    seedApprovedGate(plan.id);

    const res = await startStage(plan.id);
    const gate = (res.json().data as StageSummaryLike).gate;
    expect(gate).toHaveProperty('required');
    expect(gate).toHaveProperty('approvalId');
    expect(gate).toHaveProperty('passed');
  });
});
