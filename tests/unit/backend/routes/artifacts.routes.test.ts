import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';
import { seedArtifact, seedPhase, seedStages } from '../../../fixtures/test-db.js';

/**
 * artifacts.routes — FR-031 (산출물 동기화 추적)
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5(GET /api/artifacts · GET /api/artifacts/:id/content)
 *
 * 산출물 생성 라우트는 Phase 1 범위에 없다(DES-002 §3-3 목록에 POST가 없다) —
 * 테스트 데이터는 다른 route 테스트와 같은 방식으로 `app.db`에 직접 시딩한다.
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
