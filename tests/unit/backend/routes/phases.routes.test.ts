import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';

/**
 * FR-029 — phases.routes
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5 · DES-004 v2.2 §18
 *
 * 부트스트랩(R-01)은 이 계층(2-7) 범위 밖이라 서버 기동 시 Phase가 시드되지
 * 않는다 — 각 테스트가 `POST /api/phases`로 Phase를 직접 만든다.
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

async function createPhase(
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { data: unknown; code?: string } }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/phases',
    headers: authHeader(),
    payload: { number: 1, name: '기반 구축', ...overrides },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('POST /api/phases — R-01', () => {
  it('Given 유효한 요청일 때 When Phase를 생성하면 Then 201과 7단계가 전부 pending으로 반환된다', async () => {
    const { status, body } = await createPhase();
    expect(status).toBe(201);
    const data = body.data as { stages: { status: string }[] };
    expect(data.stages.length).toBe(7);
    expect(data.stages.every((s) => s.status === 'pending')).toBe(true);
  });

  it('number가 이미 존재하면 409 VALIDATION_ERROR', async () => {
    await createPhase({ number: 2 });
    const { status, body } = await createPhase({ number: 2 });
    expect(status).toBe(409);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('number < 1이면 400 VALIDATION_ERROR', async () => {
    const { status, body } = await createPhase({ number: 0 });
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('additionalProperties: false — 정의되지 않은 필드를 실어 보내면 400으로 거부된다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/phases',
      headers: authHeader(),
      payload: { number: 3, name: '기반 구축', currentStage: 'plan' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/phases',
      payload: { number: 4, name: '무인증' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/phases/current', () => {
  it('진행 중 Phase가 없으면 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/phases/current',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('Phase가 있으면 200과 PhaseCurrent를 반환한다', async () => {
    await createPhase({ number: 6 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/phases/current',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as {
      phase: { number: number };
      stages: { skill: string; gate: { required: boolean } }[];
      wipViolations: unknown[];
    };
    expect(data.phase.number).toBe(6);
    expect(data.wipViolations).toEqual([]);
    // gate.required 파생 — DES-002 §5 예시 근거 (plan·test만 true)
    const plan = data.stages.find((s) => s.skill === 'plan');
    const analyze = data.stages.find((s) => s.skill === 'analyze');
    expect(plan?.gate.required).toBe(true);
    expect(analyze?.gate.required).toBe(false);
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/phases/current' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/wip-waivers', () => {
  it('Given 유효한 사유일 때 When 등록하면 Then 201이 반환된다', async () => {
    const created = (await createPhase({ number: 8 })).body.data as { phase: { id: string } };

    const res = await app.inject({
      method: 'POST',
      url: '/api/wip-waivers',
      headers: authHeader(),
      payload: {
        phaseId: created.phase.id,
        rule: '주요 단계 WIP = 1',
        reason: '설계 개정과 API 명세를 병행',
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('reason이 빈 문자열이면 400 VALIDATION_ERROR (스키마 minLength)', async () => {
    const created = (await createPhase({ number: 11 })).body.data as { phase: { id: string } };

    const res = await app.inject({
      method: 'POST',
      url: '/api/wip-waivers',
      headers: authHeader(),
      payload: { phaseId: created.phase.id, rule: '주요 단계 WIP = 1', reason: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('reason이 공백뿐이면 400 VALIDATION_ERROR (서비스 trim 검증)', async () => {
    const created = (await createPhase({ number: 12 })).body.data as { phase: { id: string } };

    const res = await app.inject({
      method: 'POST',
      url: '/api/wip-waivers',
      headers: authHeader(),
      payload: { phaseId: created.phase.id, rule: '주요 단계 WIP = 1', reason: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('존재하지 않는 phaseId면 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/wip-waivers',
      headers: authHeader(),
      payload: { phaseId: crypto.randomUUID(), rule: '주요 단계 WIP = 1', reason: '사유' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('additionalProperties: false로 정의되지 않은 필드는 400으로 거부된다', async () => {
    const created = (await createPhase({ number: 13 })).body.data as { phase: { id: string } };

    const res = await app.inject({
      method: 'POST',
      url: '/api/wip-waivers',
      headers: authHeader(),
      payload: {
        phaseId: created.phase.id,
        rule: '주요 단계 WIP = 1',
        reason: '사유',
        extra: 'x',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/wip-waivers',
      payload: { phaseId: crypto.randomUUID(), rule: '주요 단계 WIP = 1', reason: '사유' },
    });
    expect(res.statusCode).toBe(401);
  });
});
