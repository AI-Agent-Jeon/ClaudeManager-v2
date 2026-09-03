import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';

/**
 * FIND-01 수정 — Project → Agent → Task 캐스케이드 (대표 결정 B안)
 *
 * 정의 원본: DES-004 §6 · DES-007 v2 §8 · DES-001 v3.2 §레이어 규칙 9
 *
 * 왜 필요한가: `project.service.ts`의 옛 `cascadeToAgents()`는 Agent까지만
 * 전이시키고 Task로 전파하지 않았다(FIND-01 런타임 재현: project cancelled →
 * `agents.status=cancelled`인데 `tasks.status=in_progress`가 잔존). 수정
 * 이후 `projects.routes.ts`의 PATCH `.../status` 핸들러가 `db.transaction()`
 * 안에서 `ProjectService.updateStatusSync()` → `AgentService
 * .cascadeFromProjectSync()`(내부에서 기존 `cascadeToTasks()`를 재사용)를
 * 조율한다. 이 파일은 그 계약을 `agent-delete-atomicity.test.ts`와 같은
 * 방식(실제 HTTP + 실제 SQLite 트랜잭션)으로 검증한다.
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

async function createProject(): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers: authHeader(),
    payload: { name: `프로젝트-${crypto.randomUUID().slice(0, 8)}` },
  });
  return res.json().data.id as string;
}

async function createAgent(projectId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/agents',
    headers: authHeader(),
    payload: { projectId, name: `에이전트-${crypto.randomUUID().slice(0, 8)}` },
  });
  return res.json().data.id as string;
}

async function createTask(agentId: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers: authHeader(),
    payload: { agentId, title: `작업-${crypto.randomUUID().slice(0, 8)}` },
  });
  return res.json().data.id as string;
}

/** 캐스케이드 이전 상태를 마음대로 만들기 위한 직접 SQL — 정상 API 경로의
 * 상태 전이 가드를 우회한다(설정 전용, 검증 대상 코드가 아니다). 다른
 * atomicity 테스트(agent-delete-atomicity.test.ts)와 같은 관례다. */
function forceStatus(table: 'agents' | 'tasks', id: string, status: string): void {
  app.db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(status, id);
}

function getStatus(table: 'projects' | 'agents' | 'tasks', id: string): string {
  return (app.db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id) as { status: string })
    .status;
}

async function statusChangeCount(entityId: string, changedBy?: string): Promise<number> {
  const res = await app.inject({
    method: 'GET',
    url: `/api/status-changes?entityId=${entityId}`,
    headers: authHeader(),
  });
  const items = res.json().data as Array<{ changedBy: string }>;
  return changedBy ? items.filter((i) => i.changedBy === changedBy).length : items.length;
}

describe('PATCH /api/projects/:id/status — FIND-01 캐스케이드(cancelled)', () => {
  it('Project가 cancelled로 전이하면 소속 Agent와 그 Task까지 일괄 cancelled된다 (DES-004 §6)', async () => {
    const projectId = await createProject();
    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });

    const agent1 = await createAgent(projectId); // running Agent, in_progress Task
    forceStatus('agents', agent1, 'running');
    const task1 = await createTask(agent1);
    forceStatus('tasks', task1, 'in_progress');

    const agent2 = await createAgent(projectId); // waiting Agent, ready Task
    forceStatus('agents', agent2, 'waiting');
    const task2 = await createTask(agent2);
    forceStatus('tasks', task2, 'ready');

    const agent3 = await createAgent(projectId); // created Agent — 캐스케이드 대상이 아니다

    const task3 = await createTask(agent1); // in_review Task — cascadeToTasks 후보가 아니다
    forceStatus('tasks', task3, 'in_review');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/status`,
      headers: authHeader(),
      payload: { status: 'cancelled' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('cancelled');

    // Project → Agent
    expect(getStatus('agents', agent1)).toBe('cancelled');
    expect(getStatus('agents', agent2)).toBe('cancelled');
    expect(getStatus('agents', agent3)).toBe('created'); // 캐스케이드 후보가 아니다

    // Agent → Task (FIND-01 — 런타임 재현 시나리오가 여기서 해소된다:
    // 수정 전에는 agents.status=cancelled인데 tasks.status가 in_progress로 잔존했다)
    expect(getStatus('tasks', task1)).toBe('cancelled');
    expect(getStatus('tasks', task2)).toBe('cancelled');
    expect(getStatus('tasks', task3)).toBe('in_review'); // 캐스케이드 후보가 아니다

    // status_changes 감사 로그 — Project·Agent·Task 3계층 전건 기록
    expect(await statusChangeCount(projectId, 'user')).toBeGreaterThanOrEqual(1);
    expect(await statusChangeCount(agent1, 'system')).toBeGreaterThanOrEqual(1);
    expect(await statusChangeCount(agent2, 'system')).toBeGreaterThanOrEqual(1);
    expect(await statusChangeCount(task1, 'system')).toBeGreaterThanOrEqual(1);
    expect(await statusChangeCount(task2, 'system')).toBeGreaterThanOrEqual(1);
  });
});

describe('PATCH /api/projects/:id/status — FIND-01 캐스케이드(paused) · 상태 머신 가드', () => {
  it('Project가 paused로 전이하면 running Agent와 그 Task만 paused된다 — waiting Agent는 건너뛴다 (DES-007 §8)', async () => {
    const projectId = await createProject();
    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });

    const runningAgent = await createAgent(projectId);
    forceStatus('agents', runningAgent, 'running');
    const runningAgentTask = await createTask(runningAgent);
    forceStatus('tasks', runningAgentTask, 'in_progress');

    // waiting → paused는 AGENT_TRANSITIONS에 없다 — 가드가 건너뛰어야 한다
    const waitingAgent = await createAgent(projectId);
    forceStatus('agents', waitingAgent, 'waiting');
    const waitingAgentTask = await createTask(waitingAgent);
    forceStatus('tasks', waitingAgentTask, 'ready');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/status`,
      headers: authHeader(),
      payload: { status: 'paused' },
    });

    expect(res.statusCode).toBe(200);
    expect(getStatus('agents', runningAgent)).toBe('paused');
    expect(getStatus('tasks', runningAgentTask)).toBe('paused');

    // 가드로 건너뛴 Agent는 전이되지 않으므로, 중첩 캐스케이드(Task)도 실행되지 않는다
    expect(getStatus('agents', waitingAgent)).toBe('waiting');
    expect(getStatus('tasks', waitingAgentTask)).toBe('ready');
  });
});

describe('PATCH /api/projects/:id/status — FIND-01 트랜잭션 원자성', () => {
  it('캐스케이드 도중(Task 갱신)이 실패하면 Project·Agent·Task 어느 것도 반영되지 않는다', async () => {
    const projectId = await createProject();
    await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/status`,
      headers: authHeader(),
      payload: { status: 'running' },
    });

    const agentId = await createAgent(projectId);
    forceStatus('agents', agentId, 'running');
    const taskId = await createTask(agentId);
    forceStatus('tasks', taskId, 'in_progress');

    // cascadeToTasks 내부의 UPDATE tasks를 실패시킨다 — 실제 better-sqlite3
    // 트랜잭션이 이 실패로 Project·Agent 반영까지 함께 롤백하는지 검증한다
    // (approval-atomicity.test.ts와 같은 db.prepare 몽키패치 방식).
    const original = app.db.prepare.bind(app.db);
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (app.db as any).prepare = (sql: string) => {
      if (sql.includes('UPDATE tasks SET status')) {
        throw new Error('Task 캐스케이드 실패 시뮬레이션');
      }
      return original(sql);
    };

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}/status`,
      headers: authHeader(),
      payload: { status: 'cancelled' },
    });

    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치 복원
    (app.db as any).prepare = original;

    expect(res.statusCode).toBe(500);

    // 롤백되었다면 Project·Agent·Task 전부 캐스케이드 이전 상태여야 한다
    expect(getStatus('projects', projectId)).toBe('running');
    expect(getStatus('agents', agentId)).toBe('running');
    expect(getStatus('tasks', taskId)).toBe('in_progress');
  });
});
