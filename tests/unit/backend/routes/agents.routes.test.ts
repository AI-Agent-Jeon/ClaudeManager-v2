import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';

/**
 * FR-007 — agents.routes
 *
 * 정의 원본: DES-002 v2.1 §3-1 · §7-2 · DES-004 v2.2 §7~8·§13
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

async function createAgent(
  projectId: string,
  name = '기본 에이전트',
  extra: Record<string, unknown> = {},
) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: authHeader(),
    payload: { projectId, name, ...extra },
  });
  return res;
}

describe('POST /api/agents — FR-007', () => {
  it('Given 프로젝트가 존재할 때 When Agent를 생성하면 Then 201과 created 상태 Agent가 반환된다', async () => {
    const project = await createProject();
    const res = await createAgent(project.id, '신규 에이전트', {
      type: 'dev-sub',
      skill: 'develop',
    });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.status).toBe('created');
    expect(body.projectId).toBe(project.id);
    expect(body.type).toBe('dev-sub');
  });

  it('Given 존재하지 않는 프로젝트일 때 When Agent를 생성하면 Then 404 PROJECT_NOT_FOUND', async () => {
    const res = await createAgent(crypto.randomUUID(), '고아 에이전트');
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('PROJECT_NOT_FOUND');
  });

  it('Given 동일 프로젝트에 같은 이름의 Agent가 있을 때 When 생성하면 Then 409 AGENT_NAME_CONFLICT', async () => {
    const project = await createProject();
    await createAgent(project.id, '중복');
    const res = await createAgent(project.id, '중복');

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('AGENT_NAME_CONFLICT');
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { projectId: crypto.randomUUID(), name: '무인증' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('name 누락 시 400 VALIDATION_ERROR', async () => {
    const project = await createProject();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: authHeader(),
      payload: { projectId: project.id },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/agents — FR-007', () => {
  it('Given Agent가 2개 존재할 때 When 목록 조회하면 Then 2건이 반환된다', async () => {
    const project = await createProject();
    await createAgent(project.id, '목록-1');
    await createAgent(project.id, '목록-2');

    const res = await app.inject({ method: 'GET', url: '/api/agents', headers: authHeader() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBe(2);
  });

  it('projectId 쿼리로 필터링된다 — 프로젝트 ID로 Agent 목록을 조회하면 해당 프로젝트의 Agent만 반환된다 (FR-007 수용 기준)', async () => {
    const projectA = await createProject('A');
    const projectB = await createProject('B');
    await createAgent(projectA.id, 'A의 에이전트');
    await createAgent(projectB.id, 'B의 에이전트');

    const res = await app.inject({
      method: 'GET',
      url: `/api/agents?projectId=${projectA.id}`,
      headers: authHeader(),
    });
    const items = res.json().data;
    expect(items.length).toBe(1);
    expect(items[0].projectId).toBe(projectA.id);
  });
});

describe('GET /api/agents/:id — FR-007', () => {
  it('Given Agent가 존재할 때 When 상세 조회하면 Then tasks·waitingReason·conversationId를 포함한 상세가 반환된다', async () => {
    const project = await createProject();
    const created = (await createAgent(project.id, '상세')).json().data;

    const res = await app.inject({
      method: 'GET',
      url: `/api/agents/${created.id}`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.tasks).toEqual([]);
    expect(body.waitingReason).toBeNull();
    expect(body.conversationId).toBeTruthy();
  });

  it('Given 존재하지 않는 Agent ID When 상세 조회하면 Then 404 AGENT_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/agents/${crypto.randomUUID()}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('AGENT_NOT_FOUND');
  });
});

describe('PATCH /api/agents/:id/status — FR-007', () => {
  it('Given 프로젝트가 running일 때 When Agent를 created → running으로 전이하면 Then 200이 반환된다', async () => {
    const project = await createProject();
    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${project.id}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });
    const created = (await createAgent(project.id, '전이')).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('running');
  });

  it('Given 프로젝트가 비활성 상태일 때 When Agent를 시작하면 Then 422 PARENT_NOT_ACTIVE', async () => {
    const project = await createProject();
    const created = (await createAgent(project.id, '부모비활성')).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('PARENT_NOT_ACTIVE');
  });

  it('Given 허용되지 않은 전이일 때 When 상태 변경하면 Then 422 INVALID_TRANSITION + allowedTransitions', async () => {
    const project = await createProject();
    const created = (await createAgent(project.id, '불허전이')).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'completed' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_TRANSITION');
    expect(res.json().details.allowedTransitions).toEqual(['running', 'cancelled']);
  });

  it('Given 존재하지 않는 Agent When 상태 변경하면 Then 404 AGENT_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${crypto.randomUUID()}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('AGENT_NOT_FOUND');
  });

  it('허용되지 않은 status enum 값은 400 VALIDATION_ERROR', async () => {
    const project = await createProject();
    const created = (await createAgent(project.id, '이넘체크')).json().data;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/agents/${created.id}/status`,
      headers: authHeader(),
      payload: { status: 'not-a-status' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/agents/:id — FR-007 (D-27)', () => {
  it('Given Agent가 존재할 때 When 삭제하면 Then 200과 archivedConversationId·closedApprovalCount(0)가 반환된다', async () => {
    const project = await createProject('삭제프로젝트');
    const created = (await createAgent(project.id, '삭제될 에이전트')).json().data;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${created.id}`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.archivedConversationId).toBeTruthy();
    expect(body.closedApprovalCount).toBe(0);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/agents/${created.id}`,
      headers: authHeader(),
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('삭제 후에도 대화가 조회되고 이름이 남아 있다 (스냅샷 보존, D-27)', async () => {
    const project = await createProject('삭제프로젝트2');
    const created = (await createAgent(project.id, '보존될 이름')).json().data;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${created.id}`,
      headers: authHeader(),
    });
    const { archivedConversationId } = deleteRes.json().data;

    // NOTE: GET /api/conversations?project=<id>는 agents 조인 기반 필터라 Agent가
    // 삭제되면 이 채널을 떨어뜨린다(conversation.repository.ts 주석 · 2-3 범위) —
    // entity_snapshot.projectId는 채워지지만 이 조회 경로가 아직 그것을 쓰지 않는다.
    // 여기서는 status=archived만으로 채널이 살아있고 이름(스냅샷)이 보존됨을 검증한다.
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations?status=archived',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data;
    const archived = items.find((c: { id: string }) => c.id === archivedConversationId);
    expect(archived).toBeTruthy();
    expect(archived.title).toBe('보존될 이름');
  });

  it('Given 존재하지 않는 Agent When 삭제하면 Then 404 AGENT_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/agents/${crypto.randomUUID()}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('AGENT_NOT_FOUND');
  });
});
