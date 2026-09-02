import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';

/**
 * FR-009 상태 변경 이력 — status-changes.routes
 *
 * 정의 원본: DES-002 v2.1 §3-1 · DES-004 v2.2 §12
 *
 * Routes → Service → Repository 경유로 리팩터링한 뒤에도 동작이 그대로인지
 * 확인한다 (레이어 규칙 2 — Routes는 Service만 호출).
 */

let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp({
    config: { dbPath: ':memory:', authSecret: 'test-secret', jwtExpiresIn: '7d' },
  });
  token = (
    await app.inject({ method: 'POST', url: '/api/auth/login', payload: { secret: 'test-secret' } })
  ).json().data.token;
});

afterEach(async () => {
  await app.close();
});

function authHeader() {
  return { authorization: `Bearer ${token}` };
}

async function createProject(name: string) {
  return (
    await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader(),
      payload: { name },
    })
  ).json().data;
}

describe('GET /api/status-changes — FR-009', () => {
  it('Given 프로젝트/Agent/Task 상태가 변경될 때 When 변경이 발생하면 Then 자동 기록된다', async () => {
    const project = await createProject('감사대상');

    const res = await app.inject({
      method: 'GET',
      url: `/api/status-changes?entityType=project&entityId=${project.id}`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const items = res.json().data;
    expect(items.length).toBe(1);
    expect(items[0].entityType).toBe('project');
    expect(items[0].entityId).toBe(project.id);
    expect(items[0].fromStatus).toBeNull();
    expect(items[0].toStatus).toBe('ready');
    expect(typeof items[0].changedAt).toBe('string');
  });

  it('Given 특정 엔티티의 When 상태 변경 이력을 조회하면 Then 시간순으로 전건이 반환된다', async () => {
    const project = await createProject('시간순');
    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/status`,
      headers: authHeader(),
      payload: { status: 'paused' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/status-changes?entityId=${project.id}`,
      headers: authHeader(),
    });

    const items = res.json().data;
    expect(items.map((i: { toStatus: string }) => i.toStatus)).toEqual([
      'ready',
      'running',
      'paused',
    ]);
  });

  it('entityType 필터가 적용된다', async () => {
    await createProject('필터-1');
    await createProject('필터-2');

    const res = await app.inject({
      method: 'GET',
      url: '/api/status-changes?entityType=project',
      headers: authHeader(),
    });

    const items = res.json().data;
    expect(items.length).toBe(2);
    expect(items.every((i: { entityType: string }) => i.entityType === 'project')).toBe(true);
  });

  it('pagination이 응답에 포함된다', async () => {
    await createProject('페이지네이션');

    const res = await app.inject({
      method: 'GET',
      url: '/api/status-changes?page=1&pageSize=1',
      headers: authHeader(),
    });

    expect(res.json().pagination).toEqual({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status-changes' });
    expect(res.statusCode).toBe(401);
  });

  it('정의되지 않은 entityType enum 값은 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/status-changes?entityType=nope',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });
});
