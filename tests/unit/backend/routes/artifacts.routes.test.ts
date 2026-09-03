import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';
import { seedArtifact, seedPhase, seedStages } from '../../../fixtures/test-db.js';

/**
 * artifacts.routes — FR-031 (산출물 동기화 추적)
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5(GET /api/artifacts · GET /api/artifacts/:id/content) ·
 * D-3(테스트 스킬 9단계 수정 루프 2차, 대표 승인) — `POST /api/artifacts` 신설
 *
 * GET 2종의 테스트 데이터는 다른 route 테스트와 같은 방식으로 `app.db`에
 * 직접 시딩한다. POST는 이 파일이 실제로 검증하는 대상이다.
 */

let app: FastifyInstance;
let token: string;
let stageId: string;

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

  const phaseId = seedPhase(app.db);
  const stages = seedStages(app.db, phaseId);
  stageId = stages.plan as string;
});

afterEach(async () => {
  await app.close();
});

function authHeader() {
  return { authorization: `Bearer ${token}` };
}

describe('GET /api/artifacts — FR-031', () => {
  it('Given 산출물이 있을 때 When 조회하면 Then syncStatus가 파생되어 응답된다', async () => {
    seedArtifact(app.db, stageId, {
      code: 'PLN-001',
      notionUrl: 'https://notion/pln-001',
      gitPath: null,
    });

    const res = await app.inject({ method: 'GET', url: '/api/artifacts', headers: authHeader() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { code: string; syncStatus: string }[];
    expect(data).toHaveLength(1);
    expect(data[0]?.syncStatus).toBe('notion_only');
  });

  it('stage 쿼리로 필터링한다', async () => {
    const otherPhaseId = seedPhase(app.db, { number: 2 });
    const otherStages = seedStages(app.db, otherPhaseId);
    seedArtifact(app.db, stageId, { code: 'PLAN-DOC' });
    seedArtifact(app.db, otherStages.analyze as string, { code: 'ANALYZE-DOC' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/artifacts?stage=${stageId}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { code: string }[];
    expect(data.map((a) => a.code)).toEqual(['PLAN-DOC']);
  });

  it('syncStatus 쿼리로 필터링한다 — notion_only와 missing이 섞이지 않는다', async () => {
    seedArtifact(app.db, stageId, {
      code: 'NOTION-ONLY',
      notionUrl: 'https://notion/x',
      gitPath: null,
    });
    seedArtifact(app.db, stageId, { code: 'MISSING', notionUrl: null, gitPath: null });

    const res = await app.inject({
      method: 'GET',
      url: '/api/artifacts?syncStatus=missing',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { code: string }[];
    expect(data.map((a) => a.code)).toEqual(['MISSING']);
  });

  it('잘못된 syncStatus 값이면 400 (스키마 enum)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/artifacts?syncStatus=bogus',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('additionalProperties: false — 정의되지 않은 쿼리는 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/artifacts?extra=x',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/artifacts' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/artifacts/:id/content — FR-031', () => {
  it('실존하는 파일이면 200과 본문을 반환한다', async () => {
    const id = seedArtifact(app.db, stageId, { code: 'REAL-DOC', gitPath: 'CHANGELOG.md' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${id}/content`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().data as { content: string }).content).toContain('CHANGELOG');
  });

  it('gitPath가 없으면 404 NOT_FOUND', async () => {
    const id = seedArtifact(app.db, stageId, { code: 'NO-GIT', gitPath: null });

    const res = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${id}/content`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('존재하지 않는 산출물 id면 404 NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${crypto.randomUUID()}/content`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('상위 경로 탈출 시도(..)는 404로 거부된다', async () => {
    const id = seedArtifact(app.db, stageId, {
      code: 'ESCAPE',
      gitPath: '../../../../../../etc/passwd',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${id}/content`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('절대 경로는 404로 거부된다', async () => {
    const id = seedArtifact(app.db, stageId, { code: 'ABS', gitPath: '/etc/passwd' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/artifacts/${id}/content`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('인증 없이 요청하면 401', async () => {
    const id = seedArtifact(app.db, stageId, { code: 'AUTH-TEST', gitPath: 'CHANGELOG.md' });
    const res = await app.inject({ method: 'GET', url: `/api/artifacts/${id}/content` });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/artifacts — D-3 (산출물 등록 경로 신설)', () => {
  it('신규 code면 201이 아니라 200과 status=draft로 생성된다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      headers: authHeader(),
      payload: { stageId, code: 'NEW-001', title: '신규 산출물' },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data as { code: string; status: string; syncStatus: string };
    expect(data.code).toBe('NEW-001');
    expect(data.status).toBe('draft');
    expect(data.syncStatus).toBe('missing');

    const followUp = await app.inject({
      method: 'GET',
      url: '/api/artifacts',
      headers: authHeader(),
    });
    expect((followUp.json().data as Array<{ code: string }>).map((a) => a.code)).toContain(
      'NEW-001',
    );
  });

  it('기존 code면 갱신한다 (id 유지, upsert)', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      headers: authHeader(),
      payload: { stageId, code: 'UP-001', title: '최초 제목' },
    });
    const firstId = (first.json().data as { id: string }).id;

    const second = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      headers: authHeader(),
      payload: {
        stageId,
        code: 'UP-001',
        title: '갱신된 제목',
        gitPath: 'docs/up-001.md',
      },
    });

    expect(second.statusCode).toBe(200);
    const data = second.json().data as {
      id: string;
      title: string;
      syncStatus: string;
    };
    expect(data.id).toBe(firstId);
    expect(data.title).toBe('갱신된 제목');
    expect(data.syncStatus).toBe('git_only');
  });

  it('status=approved인 기존 행을 upsert해도 draft로 되돌아가지 않는다 (불변식 회귀 방어)', async () => {
    const id = seedArtifact(app.db, stageId, { code: 'APPROVED-001', status: 'approved' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      headers: authHeader(),
      payload: { stageId, code: 'APPROVED-001', title: '갱신 시도' },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data as { id: string; status: string };
    expect(data.id).toBe(id);
    expect(data.status).toBe('approved');
  });

  it.each([
    ['synced', 'https://notion/x', 'docs/x.md'],
    ['notion_only', 'https://notion/x', undefined],
    ['git_only', undefined, 'docs/x.md'],
    ['missing', undefined, undefined],
  ])('syncStatus는 notionUrl·gitPath에서 파생된다 — %s', async (expected, notionUrl, gitPath) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      headers: authHeader(),
      payload: { stageId, code: `DERIVE-${expected}`, title: 't', notionUrl, gitPath },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json().data as { syncStatus: string }).syncStatus).toBe(expected);
  });

  it('존재하지 않는 stageId면 4xx (STAGE_NOT_FOUND)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      headers: authHeader(),
      payload: { stageId: crypto.randomUUID(), code: 'NO-STAGE', title: 't' },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.json().code).toBe('STAGE_NOT_FOUND');
  });

  it('필수 필드(stageId·code·title) 누락 시 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      headers: authHeader(),
      payload: { stageId, code: 'MISSING-TITLE' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('status·syncStatus 주입을 시도하면 400 — additionalProperties: false가 막는다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      headers: authHeader(),
      payload: { stageId, code: 'INJECT-001', title: 't', status: 'approved' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/artifacts',
      payload: { stageId, code: 'AUTH-POST', title: 't' },
    });
    expect(res.statusCode).toBe(401);
  });
});
