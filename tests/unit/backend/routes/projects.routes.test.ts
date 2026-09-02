import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';

/**
 * FR-003 ~ FR-006 — projects.routes
 *
 * 정의 원본: DES-002 v2.1 §3-1 · §7-2 · DES-004 v2.2 §3~6
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

describe('POST /api/projects — FR-003', () => {
  it('Given 인증된 상태일 때 When 이름·설명을 제공하면 Then 201과 ready 상태 프로젝트가 반환된다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: '신규 프로젝트', description: '설명' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.status).toBe('ready');
    expect(body.data.name).toBe('신규 프로젝트');
  });

  it('Given 동일 이름의 프로젝트가 존재할 때 When 같은 이름으로 생성하면 Then 409 PROJECT_NAME_CONFLICT', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: '중복' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: '중복' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PROJECT_NAME_CONFLICT');
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: '무인증' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('name 누락 시 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('정의되지 않은 필드를 실으면 거부한다 (additionalProperties: false)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name: '이름', status: 'running' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/projects — FR-004', () => {
  it('Given 프로젝트가 3개 존재할 때 When 목록 조회하면 Then 3건이 반환된다', async () => {
    for (const name of ['목록-1', '목록-2', '목록-3']) {
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeader(),
        payload: { name },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: authHeader() });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(3);
    expect(body.pagination.total).toBe(3);
  });

  it('Given 프로젝트가 없을 때 When 목록 조회하면 Then 빈 목록이 반환된다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: authHeader() });
    expect(res.json().data).toEqual([]);
  });
});

describe('GET /api/projects/:id — FR-005', () => {
  it('Given 프로젝트가 존재할 때 When 상세 조회하면 Then 200과 Agent 목록을 포함한 상세가 반환된다', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeader(),
        payload: { name: '상세', description: '상세 설명' },
      })
    ).json().data;

    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${created.id}`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.name).toBe('상세');
    expect(body.description).toBe('상세 설명');
    expect(body.agents).toEqual([]);
  });

  it('Given 존재하지 않는 프로젝트 ID When 상세 조회하면 Then 404 PROJECT_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/projects/${crypto.randomUUID()}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('PROJECT_NOT_FOUND');
  });
});

describe('PATCH /api/projects/:id/status — FR-006', () => {
  it('Given ready 상태일 때 When running으로 변경하면 Then 200과 갱신된 상태가 반환된다', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeader(),
        payload: { name: '전이' },
      })
    ).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('running');
  });

  it('Given 허용되지 않은 전이일 때 When 상태 변경 요청하면 Then 422 INVALID_TRANSITION', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeader(),
        payload: { name: '불허전이' },
      })
    ).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'completed' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_TRANSITION');
  });

  it('Given 존재하지 않는 프로젝트 When 상태 변경하면 Then 404 PROJECT_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${crypto.randomUUID()}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('PROJECT_NOT_FOUND');
  });

  it('허용되지 않은 status enum 값은 400 VALIDATION_ERROR', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeader(),
        payload: { name: '이넘체크' },
      })
    ).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'not-a-status' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('상태 변경이 status_changes 이력에 기록된다 (FR-009 연동)', async () => {
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeader(),
        payload: { name: '이력연동' },
      })
    ).json().data;

    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/status-changes?entityId=${created.id}`,
      headers: authHeader(),
    });

    const items = res.json().data;
    expect(items.length).toBe(2);
    expect(items[0].fromStatus).toBeNull();
    expect(items[0].toStatus).toBe('ready');
    expect(items[1].fromStatus).toBe('ready');
    expect(items[1].toStatus).toBe('running');
  });
});
