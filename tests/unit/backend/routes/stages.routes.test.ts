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

async function completeStage(stageId: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/stages/${stageId}/complete`,
    headers: authHeader(),
    ...(payload !== undefined ? { payload } : {}),
  });
}

function getPhase(phaseId: string): { current_stage: string | null } {
  return app.db.prepare('SELECT current_stage FROM phases WHERE id = ?').get(phaseId) as {
    current_stage: string | null;
  };
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

/**
 * POST /api/stages/:id/complete — Layer 2-8 보완 (대표 승인 A안)
 *
 * DES-002 §3-3 엔드포인트 목록에 `complete`가 빠져 있어 `plan` 착수 이후
 * 어떤 후속 단계도 착수할 수 없던 단절을 해소한다. 선행 조건(산출물·승인)은
 * 두지 않는다 — 대표 지시 §1.
 */
describe('POST /api/stages/:id/complete', () => {
  it('in_progress 단계를 completed로 전이하고 completed_at을 기록한다', async () => {
    const current = await createPhaseWithStages(201);
    const plan = findStage(current, 'plan');
    seedApprovedGate(plan.id);
    await startStage(plan.id);

    const res = await completeStage(plan.id);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as StageSummaryLike & { completedAt: string | null };
    expect(data.status).toBe('completed');
    expect(data.completedAt).not.toBeNull();
  });

  it('pending 단계를 완료하려 하면 422 INVALID_TRANSITION', async () => {
    const current = await createPhaseWithStages(202);
    const analyze = findStage(current, 'analyze');

    const res = await completeStage(analyze.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_TRANSITION');
  });

  it('이미 completed인 단계를 재완료하려 하면 422 INVALID_TRANSITION', async () => {
    const current = await createPhaseWithStages(203);
    const plan = findStage(current, 'plan');
    seedApprovedGate(plan.id);
    await startStage(plan.id);
    await completeStage(plan.id);

    const res = await completeStage(plan.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_TRANSITION');
  });

  it('존재하지 않는 단계 id면 404 STAGE_NOT_FOUND', async () => {
    const res = await completeStage(crypto.randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('STAGE_NOT_FOUND');
  });

  it('완료해도 phases.current_stage는 바뀌지 않는다 (다음 start가 갱신한다)', async () => {
    const current = await createPhaseWithStages(204);
    const plan = findStage(current, 'plan');
    seedApprovedGate(plan.id);
    await startStage(plan.id);
    expect(getPhase(current.phase.id).current_stage).toBe('plan');

    await completeStage(plan.id);

    expect(getPhase(current.phase.id).current_stage).toBe('plan');
  });

  it('완료 시 status_changes에 entity_type=stage로 기록된다', async () => {
    const current = await createPhaseWithStages(205);
    const plan = findStage(current, 'plan');
    seedApprovedGate(plan.id);
    await startStage(plan.id);

    await completeStage(plan.id);

    const changes = app.db
      .prepare(
        "SELECT * FROM status_changes WHERE entity_type = 'stage' AND entity_id = ? AND to_status = 'completed'",
      )
      .all(plan.id) as { from_status: string | null; to_status: string }[];
    expect(changes.length).toBe(1);
    expect(changes[0]?.from_status).toBe('in_progress');
  });

  it('요청 본문에 알 수 없는 필드가 있으면 400 (additionalProperties: false)', async () => {
    const current = await createPhaseWithStages(206);
    const plan = findStage(current, 'plan');
    seedApprovedGate(plan.id);
    await startStage(plan.id);

    const res = await completeStage(plan.id, { note: '허용되지 않는 필드' });
    expect(res.statusCode).toBe(400);
  });

  it('요청 본문 없이 호출해도 200 (본문 불필요)', async () => {
    const current = await createPhaseWithStages(207);
    const plan = findStage(current, 'plan');
    seedApprovedGate(plan.id);
    await startStage(plan.id);

    const res = await completeStage(plan.id);
    expect(res.statusCode).toBe(200);
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/stages/${crypto.randomUUID()}/complete`,
    });
    expect(res.statusCode).toBe(401);
  });
});

/**
 * 플로우 회귀 테스트 (개발 지시 §3, 중요) — 이번에 고친 단절의 방어선.
 * `complete` 라우트가 없으면 `plan` 착수 후 `analyze`를 영원히 착수할 수
 * 없었다(가드 1 "직전 단계가 completed"를 만족시킬 방법이 없었으므로).
 * plan은 게이트 필요 단계라 APV-GATE 승인을 갖춘 상태로 구성한다.
 */
describe('플로우 회귀 — plan 착수 → 완료 → analyze 착수 (Layer 2-8 보완의 방어선)', () => {
  it('plan을 착수·완료한 뒤 analyze 착수가 실제로 성공한다', async () => {
    const current = await createPhaseWithStages(301);
    const plan = findStage(current, 'plan');
    const analyze = findStage(current, 'analyze');
    seedApprovedGate(plan.id);

    const startRes = await startStage(plan.id);
    expect(startRes.statusCode).toBe(200);

    const completeRes = await completeStage(plan.id);
    expect(completeRes.statusCode).toBe(200);
    expect((completeRes.json().data as StageSummaryLike).status).toBe('completed');

    const analyzeStartRes = await startStage(analyze.id);
    expect(analyzeStartRes.statusCode).toBe(200);
    expect((analyzeStartRes.json().data as StageSummaryLike).status).toBe('in_progress');
  });
});
