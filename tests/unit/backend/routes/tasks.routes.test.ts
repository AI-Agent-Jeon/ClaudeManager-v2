import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';

/**
 * FR-008 — tasks.routes
 *
 * 정의 원본: DES-002 v2.1 §3-1 · §7-2 · DES-004 v2.2 §9~11
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

async function createProject(name = '기본 프로젝트') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: authHeader(),
    payload: { name },
  });
  return res.json().data as { id: string };
}

async function createAgent(projectId: string, name = '기본 에이전트') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: authHeader(),
    payload: { projectId, name },
  });
  return res.json().data as { id: string };
}

async function setAgentRunning(projectId: string, agentId: string) {
  await app.inject({
    method: 'PATCH',
    url: `/api/projects/${projectId}/status`,
    headers: authHeader(),
    payload: { status: 'running' },
  });
  await app.inject({
    method: 'PATCH',
    url: `/api/agents/${agentId}/status`,
    headers: authHeader(),
    payload: { status: 'running' },
  });
}

describe('POST /api/tasks — FR-008', () => {
  it('Given Agent가 존재할 때 When Task를 생성하면 Then 201과 ready 상태 Task가 반환된다', async () => {
    const project = await createProject();
    const agent = await createAgent(project.id);

    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { agentId: agent.id, title: '신규 작업', description: '설명' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.status).toBe('ready');
    expect(body.agentId).toBe(agent.id);
  });

  it('Given 존재하지 않는 Agent일 때 When Task를 생성하면 Then 404 AGENT_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { agentId: crypto.randomUUID(), title: '고아 작업' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('AGENT_NOT_FOUND');
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: { agentId: crypto.randomUUID(), title: '무인증' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('title 누락 시 400 VALIDATION_ERROR', async () => {
    const project = await createProject();
    const agent = await createAgent(project.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/tasks — FR-008', () => {
  it('Given Task가 2개 존재할 때 When 목록 조회하면 Then 2건이 반환된다', async () => {
    const project = await createProject();
    const agent = await createAgent(project.id);
    for (const title of ['목록-1', '목록-2']) {
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: authHeader(),
        payload: { agentId: agent.id, title },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/tasks', headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(2);
  });

  it('agentId 쿼리로 필터링된다', async () => {
    const project = await createProject();
    const agentA = await createAgent(project.id, 'A');
    const agentB = await createAgent(project.id, 'B');
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { agentId: agentA.id, title: 'A의 작업' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: authHeader(),
      payload: { agentId: agentB.id, title: 'B의 작업' },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/tasks?agentId=${agentA.id}`,
      headers: authHeader(),
    });
    const items = res.json().data;
    expect(items.length).toBe(1);
    expect(items[0].agentId).toBe(agentA.id);
  });
});

describe('GET /api/tasks/:id — FR-008', () => {
  it('Given Task가 존재할 때 When 상세 조회하면 Then 200과 Task가 반환된다', async () => {
    const project = await createProject();
    const agent = await createAgent(project.id);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: authHeader(),
        payload: { agentId: agent.id, title: '상세' },
      })
    ).json().data;

    const res = await app.inject({
      method: 'GET',
      url: `/api/tasks/${created.id}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.title).toBe('상세');
  });

  it('Given 존재하지 않는 Task ID When 상세 조회하면 Then 404 TASK_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/tasks/${crypto.randomUUID()}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('TASK_NOT_FOUND');
  });
});

describe('PATCH /api/tasks/:id/status — FR-008', () => {
  it('Given Agent가 running일 때 When Task를 ready → in_progress로 전이하면 Then 200이 반환된다', async () => {
    const project = await createProject();
    const agent = await createAgent(project.id);
    await setAgentRunning(project.id, agent.id);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: authHeader(),
        payload: { agentId: agent.id, title: '전이' },
      })
    ).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'in_progress' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('in_progress');
  });

  it('Given Agent가 비활성 상태일 때 When Task를 시작하면 Then 422 PARENT_NOT_ACTIVE', async () => {
    const project = await createProject();
    const agent = await createAgent(project.id);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: authHeader(),
        payload: { agentId: agent.id, title: '부모비활성' },
      })
    ).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'in_progress' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('PARENT_NOT_ACTIVE');
  });

  it('Task는 in_review를 거쳐야 completed가 된다 — in_progress → completed 직접 전이는 422 INVALID_TRANSITION (DES-007 §4)', async () => {
    const project = await createProject();
    const agent = await createAgent(project.id);
    await setAgentRunning(project.id, agent.id);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: authHeader(),
        payload: { agentId: agent.id, title: '직접완료불가' },
      })
    ).json().data;
    await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'in_progress' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'completed' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_TRANSITION');
    expect(res.json().details.allowedTransitions).toEqual([
      'in_review',
      'paused',
      'failed',
      'cancelled',
    ]);
  });

  it('Given 존재하지 않는 Task When 상태 변경하면 Then 404 TASK_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${crypto.randomUUID()}/status`,
      headers: authHeader(),
      payload: { status: 'in_progress' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('TASK_NOT_FOUND');
  });

  it('허용되지 않은 status enum 값은 400 VALIDATION_ERROR', async () => {
    const project = await createProject();
    const agent = await createAgent(project.id);
    const created = (
      await app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers: authHeader(),
        payload: { agentId: agent.id, title: '이넘체크' },
      })
    ).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'not-a-status' },
    });
    expect(res.statusCode).toBe(400);
  });
});
