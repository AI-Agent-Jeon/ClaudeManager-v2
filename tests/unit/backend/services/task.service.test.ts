import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../../../src/backend/repositories/agent.repository.js';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { TaskRepository } from '../../../../src/backend/repositories/task.repository.js';
import { TaskService } from '../../../../src/backend/services/task.service.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import { createTestDb, seedAgent, seedProject, type TestDb } from '../../../fixtures/test-db.js';

/**
 * FR-008 — TaskService
 *
 * 정의 원본: DES-004 v2.2 §9~11 · §전체 함수 시그니처 요약 (Services)
 * 상태 머신: DES-007 v2.1 §4·§8
 */

let testDb: TestDb;
let service: TaskService;
let taskRepo: TaskRepository;
let agentRepo: AgentRepository;
let statusChangeRepo: StatusChangeRepository;
let projectId: string;
let agentId: string;

beforeEach(() => {
  testDb = createTestDb();
  taskRepo = new TaskRepository(testDb.db);
  agentRepo = new AgentRepository(testDb.db);
  statusChangeRepo = new StatusChangeRepository(testDb.db);
  service = new TaskService(taskRepo, statusChangeRepo, agentRepo);
  projectId = seedProject(testDb.db);
  agentId = seedAgent(testDb.db, projectId, { name: '기본 에이전트', status: 'created' });
});

afterEach(() => {
  testDb.close();
});

describe('TaskService.create — FR-008', () => {
  it('Given Agent에 Task가 할당될 때 When 생성을 요청하면 Then ready 상태로 생성된다', async () => {
    const task = await service.create({ agentId, title: '신규 작업', description: '설명' });

    expect(task.status).toBe('ready');
    expect(task.agentId).toBe(agentId);
    expect(task.title).toBe('신규 작업');
    expect(task.description).toBe('설명');
  });

  it('description 생략 시 빈 문자열로 저장된다', async () => {
    const task = await service.create({ agentId, title: '설명없음' });
    expect(task.description).toBe('');
  });

  it('Given 존재하지 않는 Agent When Task 생성하면 Then 404 AGENT_NOT_FOUND', async () => {
    await expect(
      service.create({ agentId: crypto.randomUUID(), title: '고아 작업' }),
    ).rejects.toThrow(AppError);
    try {
      await service.create({ agentId: crypto.randomUUID(), title: '고아 작업' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('AGENT_NOT_FOUND');
    }
  });

  it('생성 시 status_changes에 fromStatus null → toStatus ready로 기록된다 (FR-009)', async () => {
    const task = await service.create({ agentId, title: '이력확인' });

    const rows = statusChangeRepo.findMany({ offset: 0, limit: 20, entityId: task.id });
    expect(rows.length).toBe(1);
    expect(rows[0]?.from_status).toBeNull();
    expect(rows[0]?.to_status).toBe('ready');
    expect(rows[0]?.changed_by).toBe('system');
  });
});

describe('TaskService.list — FR-008', () => {
  it('Given Task가 3개 존재할 때 When 목록 조회하면 Then 3건이 반환된다', async () => {
    await service.create({ agentId, title: '목록-1' });
    await service.create({ agentId, title: '목록-2' });
    await service.create({ agentId, title: '목록-3' });

    const { items, pagination } = await service.list({ page: 1, pageSize: 20 });
    expect(items.length).toBe(3);
    expect(pagination.total).toBe(3);
  });

  it('agentId로 필터링된다', async () => {
    const otherAgentId = seedAgent(testDb.db, projectId, { name: '다른 에이전트' });
    await service.create({ agentId, title: '내 작업' });
    await service.create({ agentId: otherAgentId, title: '다른 작업' });

    const { items } = await service.list({ page: 1, pageSize: 20, agentId });
    expect(items.length).toBe(1);
    expect(items[0]?.agentId).toBe(agentId);
  });
});

describe('TaskService.getById — FR-008', () => {
  it('Given Task가 존재할 때 When 조회하면 Then 반환된다', async () => {
    const created = await service.create({ agentId, title: '상세조회' });
    const task = await service.getById(created.id);
    expect(task.title).toBe('상세조회');
  });

  it('Given 존재하지 않는 Task ID When 조회하면 Then 404 TASK_NOT_FOUND', async () => {
    await expect(service.getById(crypto.randomUUID())).rejects.toThrow(AppError);
    try {
      await service.getById(crypto.randomUUID());
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('TASK_NOT_FOUND');
    }
  });
});

describe('TaskService.updateStatus — FR-008', () => {
  it('Given Agent가 running일 때 When Task를 ready → in_progress로 전이하면 Then 성공한다', async () => {
    agentRepo.updateStatus(agentId, 'running', null, new Date().toISOString());
    const task = await service.create({ agentId, title: '전이테스트' });

    const updated = await service.updateStatus(task.id, 'in_progress');
    expect(updated.status).toBe('in_progress');
  });

  it('Given Agent가 비활성(created) 상태일 때 When Task를 시작하면 Then 422 PARENT_NOT_ACTIVE', async () => {
    const task = await service.create({ agentId, title: '부모비활성' });

    await expect(service.updateStatus(task.id, 'in_progress')).rejects.toThrow(AppError);
    try {
      await service.updateStatus(task.id, 'in_progress');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('PARENT_NOT_ACTIVE');
    }
  });

  it('Task는 in_review를 거쳐야 completed가 된다 — in_progress → completed 직접 전이는 거부된다 (DES-007 §4)', async () => {
    agentRepo.updateStatus(agentId, 'running', null, new Date().toISOString());
    const task = await service.create({ agentId, title: '직접완료불가' });
    await service.updateStatus(task.id, 'in_progress');

    await expect(service.updateStatus(task.id, 'completed')).rejects.toThrow(AppError);
    try {
      await service.updateStatus(task.id, 'completed');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
      expect((e as AppError).details?.allowedTransitions).toEqual([
        'in_review',
        'paused',
        'failed',
        'cancelled',
      ]);
    }
  });

  it('in_review를 거치면 completed로 전이할 수 있다 (DES-007 §4)', async () => {
    agentRepo.updateStatus(agentId, 'running', null, new Date().toISOString());
    const task = await service.create({ agentId, title: '정상완료' });
    await service.updateStatus(task.id, 'in_progress');
    await service.updateStatus(task.id, 'in_review');

    const completed = await service.updateStatus(task.id, 'completed');
    expect(completed.status).toBe('completed');
  });

  it('Given 존재하지 않는 Task When 상태 변경하면 Then 404 TASK_NOT_FOUND', async () => {
    await expect(service.updateStatus(crypto.randomUUID(), 'in_progress')).rejects.toThrow(
      AppError,
    );
    try {
      await service.updateStatus(crypto.randomUUID(), 'in_progress');
    } catch (e) {
      expect((e as AppError).code).toBe('TASK_NOT_FOUND');
    }
  });

  it('상태 변경이 status_changes 이력에 기록된다 (FR-009 연동)', async () => {
    agentRepo.updateStatus(agentId, 'running', null, new Date().toISOString());
    const task = await service.create({ agentId, title: '이력연동' });

    await service.updateStatus(task.id, 'in_progress');

    const rows = statusChangeRepo.findMany({ offset: 0, limit: 20, entityId: task.id });
    expect(rows.length).toBe(2);
    expect(rows[1]?.from_status).toBe('ready');
    expect(rows[1]?.to_status).toBe('in_progress');
    expect(rows[1]?.changed_by).toBe('user');
  });
});
