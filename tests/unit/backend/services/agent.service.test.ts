import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../../../src/backend/repositories/agent.repository.js';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import { ProjectRepository } from '../../../../src/backend/repositories/project.repository.js';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { TaskRepository } from '../../../../src/backend/repositories/task.repository.js';
import { AgentService } from '../../../../src/backend/services/agent.service.js';
import { ConversationService } from '../../../../src/backend/services/conversation.service.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import { createTestDb, seedAgent, seedProject, type TestDb } from '../../../fixtures/test-db.js';

/**
 * FR-007 — AgentService
 *
 * 정의 원본: DES-004 v2.2 §7~8·§13 · §전체 함수 시그니처 요약 (Services)
 * 상태 머신: DES-007 v2.1 §3·§8
 */

let testDb: TestDb;
let service: AgentService;
let agentRepo: AgentRepository;
let taskRepo: TaskRepository;
let projectRepo: ProjectRepository;
let statusChangeRepo: StatusChangeRepository;
let conversationRepo: ConversationRepository;

beforeEach(() => {
  testDb = createTestDb();
  agentRepo = new AgentRepository(testDb.db);
  taskRepo = new TaskRepository(testDb.db);
  projectRepo = new ProjectRepository(testDb.db);
  statusChangeRepo = new StatusChangeRepository(testDb.db);
  conversationRepo = new ConversationRepository(testDb.db);
  const conversationService = new ConversationService(
    conversationRepo,
    new MessageRepository(testDb.db),
  );
  service = new AgentService(
    testDb.db,
    agentRepo,
    statusChangeRepo,
    projectRepo,
    taskRepo,
    conversationService,
    conversationRepo,
  );
});

afterEach(() => {
  testDb.close();
});

describe('AgentService.create — FR-007', () => {
  it('Given 프로젝트가 존재할 때 When Agent 생성을 요청하면 Then created 상태로 생성된다', async () => {
    const projectId = seedProject(testDb.db, { name: '대상 프로젝트' });

    const agent = await service.create({
      projectId,
      name: '신규 에이전트',
      type: 'dev-sub',
      skill: 'develop',
    });

    expect(agent.status).toBe('created');
    expect(agent.name).toBe('신규 에이전트');
    expect(agent.projectId).toBe(projectId);
    expect(agent.type).toBe('dev-sub');
    expect(agent.skill).toBe('develop');
    expect(agent.config).toEqual({});
    expect(agent.retryCount).toBe(0);
  });

  it('Agent 생성 시 CH-AGENT가 함께 만들어진다 (D-09 · DES-004 §7)', async () => {
    const projectId = seedProject(testDb.db);
    const agent = await service.create({ projectId, name: '채널확인' });

    const conv = conversationRepo.findByEntityId(agent.id);
    expect(conv).not.toBeNull();
    expect(conv?.channel_type).toBe('agent');
    expect(conv?.status).toBe('active');
  });

  it('Given 존재하지 않는 프로젝트 When Agent 생성하면 Then 404 PROJECT_NOT_FOUND', async () => {
    await expect(
      service.create({ projectId: crypto.randomUUID(), name: '고아 에이전트' }),
    ).rejects.toThrow(AppError);
    try {
      await service.create({ projectId: crypto.randomUUID(), name: '고아 에이전트' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('PROJECT_NOT_FOUND');
    }
  });

  it('Given 같은 프로젝트에 동일 이름의 Agent가 있을 때 When 생성하면 Then 409 AGENT_NAME_CONFLICT', async () => {
    const projectId = seedProject(testDb.db);
    await service.create({ projectId, name: '중복' });

    await expect(service.create({ projectId, name: '중복' })).rejects.toThrow(AppError);
    try {
      await service.create({ projectId, name: '중복' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(409);
      expect((e as AppError).code).toBe('AGENT_NAME_CONFLICT');
    }
  });

  it('생성 시 status_changes에 fromStatus null → toStatus created로 기록된다 (FR-009)', async () => {
    const projectId = seedProject(testDb.db);
    const agent = await service.create({ projectId, name: '이력확인' });

    const rows = statusChangeRepo.findMany({ offset: 0, limit: 20, entityId: agent.id });
    expect(rows.length).toBe(1);
    expect(rows[0]?.from_status).toBeNull();
    expect(rows[0]?.to_status).toBe('created');
    expect(rows[0]?.changed_by).toBe('system');
  });
});

describe('AgentService.list — FR-007', () => {
  it('Given Agent가 3개 존재할 때 When 목록 조회하면 Then 3건이 반환된다', async () => {
    const projectId = seedProject(testDb.db);
    await service.create({ projectId, name: '목록-1' });
    await service.create({ projectId, name: '목록-2' });
    await service.create({ projectId, name: '목록-3' });

    const { items, pagination } = await service.list({ page: 1, pageSize: 20 });
    expect(items.length).toBe(3);
    expect(pagination.total).toBe(3);
  });

  it('projectId로 필터링된다 — 프로젝트 ID로 Agent 목록을 조회하면 해당 프로젝트의 Agent만 반환된다 (FR-007 수용 기준)', async () => {
    const projectA = seedProject(testDb.db, { name: 'A' });
    const projectB = seedProject(testDb.db, { name: 'B' });
    await service.create({ projectId: projectA, name: 'A의 에이전트' });
    await service.create({ projectId: projectB, name: 'B의 에이전트' });

    const { items } = await service.list({ page: 1, pageSize: 20, projectId: projectA });
    expect(items.length).toBe(1);
    expect(items[0]?.projectId).toBe(projectA);
  });
});

describe('AgentService.getById — FR-007', () => {
  it('Given Agent가 존재할 때 When 상세 조회하면 Then tasks·waitingReason·conversationId가 채워진다', async () => {
    const projectId = seedProject(testDb.db);
    const agent = await service.create({ projectId, name: '상세조회' });

    const detail = await service.getById(agent.id);

    expect(detail.tasks).toEqual([]);
    expect(detail.waitingReason).toBeNull();
    expect(detail.conversationId).toBeTruthy();
  });

  it('waiting에서 running으로 전이하면 waiting_reason이 초기화되어 null로 나간다 (D-11)', async () => {
    const projectId = seedProject(testDb.db, { status: 'running' });
    const agentId = seedAgent(testDb.db, projectId, {
      status: 'waiting',
      waitingReason: 'ceo_decision',
    });

    await service.updateStatus(agentId, 'running');
    const detail = await service.getById(agentId);

    expect(detail.status).toBe('running');
    expect(detail.waitingReason).toBeNull();
  });

  it('status가 waiting이면 waiting_reason 값이 그대로 나간다 (D-11)', async () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId, {
      status: 'waiting',
      waitingReason: 'ceo_decision',
    });

    const detail = await service.getById(agentId);
    expect(detail.waitingReason).toBe('ceo_decision');
  });

  it('Given 존재하지 않는 Agent ID When 상세 조회하면 Then 404 AGENT_NOT_FOUND', async () => {
    await expect(service.getById(crypto.randomUUID())).rejects.toThrow(AppError);
    try {
      await service.getById(crypto.randomUUID());
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('AGENT_NOT_FOUND');
    }
  });

  it('Given Agent에 Task가 있을 때 When 상세 조회하면 Then tasks가 채워진다', async () => {
    const projectId = seedProject(testDb.db);
    const agent = await service.create({ projectId, name: 'Task포함' });
    taskRepo.insert({
      id: crypto.randomUUID(),
      agentId: agent.id,
      title: '작업-1',
      description: '',
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const detail = await service.getById(agent.id);
    expect(detail.tasks.length).toBe(1);
    expect(detail.tasks[0]?.title).toBe('작업-1');
    expect(detail.tasks[0]?.agentId).toBe(agent.id);
  });
});

describe('AgentService.updateStatus — FR-007', () => {
  it('Given 프로젝트가 running일 때 When Agent를 created → running으로 전이하면 Then 성공한다', async () => {
    const projectId = seedProject(testDb.db, { status: 'running' });
    const agent = await service.create({ projectId, name: '전이테스트' });

    const updated = await service.updateStatus(agent.id, 'running');
    expect(updated.status).toBe('running');
  });

  it('Given 프로젝트가 비활성(ready) 상태일 때 When Agent를 시작하면 Then 422 PARENT_NOT_ACTIVE', async () => {
    const projectId = seedProject(testDb.db, { status: 'ready' });
    const agent = await service.create({ projectId, name: '부모비활성' });

    await expect(service.updateStatus(agent.id, 'running')).rejects.toThrow(AppError);
    try {
      await service.updateStatus(agent.id, 'running');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('PARENT_NOT_ACTIVE');
    }
  });

  it('Given 허용되지 않은 전이일 때 When 상태 변경하면 Then 422 INVALID_TRANSITION + allowedTransitions', async () => {
    const projectId = seedProject(testDb.db, { status: 'running' });
    const agent = await service.create({ projectId, name: '불허전이' });

    await expect(service.updateStatus(agent.id, 'completed')).rejects.toThrow(AppError);
    try {
      await service.updateStatus(agent.id, 'completed');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
      expect((e as AppError).details?.allowedTransitions).toEqual(['running', 'cancelled']);
    }
  });

  it('Given 존재하지 않는 Agent When 상태 변경하면 Then 404 AGENT_NOT_FOUND', async () => {
    await expect(service.updateStatus(crypto.randomUUID(), 'running')).rejects.toThrow(AppError);
    try {
      await service.updateStatus(crypto.randomUUID(), 'running');
    } catch (e) {
      expect((e as AppError).code).toBe('AGENT_NOT_FOUND');
    }
  });

  it('Agent가 completed/cancelled로 전이되면 CH-AGENT가 readonly가 된다 (DES-007 §8)', async () => {
    const projectId = seedProject(testDb.db, { status: 'running' });
    const agent = await service.create({ projectId, name: '종료테스트' });
    await service.updateStatus(agent.id, 'running');

    await service.updateStatus(agent.id, 'completed');

    const conv = conversationRepo.findByEntityId(agent.id);
    expect(conv?.status).toBe('readonly');
  });

  it('Agent → cancelled 캐스케이드 — 소속 ready/in_progress Task가 일괄 cancelled된다 (DES-007 §8)', async () => {
    const projectId = seedProject(testDb.db, { status: 'running' });
    const agent = await service.create({ projectId, name: '취소캐스케이드' });
    await service.updateStatus(agent.id, 'running');

    const readyTaskId = crypto.randomUUID();
    const inProgressTaskId = crypto.randomUUID();
    taskRepo.insert({
      id: readyTaskId,
      agentId: agent.id,
      title: '대기중 작업',
      description: '',
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    taskRepo.insert({
      id: inProgressTaskId,
      agentId: agent.id,
      title: '진행중 작업',
      description: '',
      status: 'in_progress',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await service.updateStatus(agent.id, 'cancelled');

    expect(taskRepo.findById(readyTaskId)?.status).toBe('cancelled');
    expect(taskRepo.findById(inProgressTaskId)?.status).toBe('cancelled');
  });

  it('Agent → paused 캐스케이드 — in_progress Task만 paused되고 ready Task는 그대로다 (DES-007 §8)', async () => {
    const projectId = seedProject(testDb.db, { status: 'running' });
    const agent = await service.create({ projectId, name: '일시정지캐스케이드' });
    await service.updateStatus(agent.id, 'running');

    const readyTaskId = crypto.randomUUID();
    const inProgressTaskId = crypto.randomUUID();
    taskRepo.insert({
      id: readyTaskId,
      agentId: agent.id,
      title: '대기중 작업',
      description: '',
      status: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    taskRepo.insert({
      id: inProgressTaskId,
      agentId: agent.id,
      title: '진행중 작업',
      description: '',
      status: 'in_progress',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await service.updateStatus(agent.id, 'paused');

    expect(taskRepo.findById(inProgressTaskId)?.status).toBe('paused');
    // ready → paused는 TASK_TRANSITIONS에 없어 캐스케이드에서 제외된다
    expect(taskRepo.findById(readyTaskId)?.status).toBe('ready');
  });
});

describe('AgentService.delete — FR-007 (D-27)', () => {
  it('Given Agent가 존재할 때 When 삭제하면 Then 대화는 보존되고 archivedConversationId·closedApprovalCount(0)가 반환된다', async () => {
    const projectId = seedProject(testDb.db, { name: '삭제대상 프로젝트' });
    const agent = await service.create({ projectId, name: '삭제될 에이전트', type: 'dev-sub' });
    const convBefore = conversationRepo.findByEntityId(agent.id);

    const result = await service.delete(agent.id);

    expect(result.archivedConversationId).toBe(convBefore?.id);
    expect(result.closedApprovalCount).toBe(0);
    expect(agentRepo.findById(agent.id)).toBeNull();
  });

  it('삭제 후에도 대화가 조회되고 이름이 남아 있다 (스냅샷 + projectId 포함)', async () => {
    const projectId = seedProject(testDb.db, { name: '삭제대상 프로젝트' });
    const agent = await service.create({ projectId, name: '삭제될 에이전트', type: 'dev-sub' });

    const result = await service.delete(agent.id);

    const conv = conversationRepo.findByIdWithAgent(result.archivedConversationId as string);
    expect(conv).not.toBeNull();
    expect(conv?.status).toBe('archived');
    expect(conv?.entity_snapshot).toBeTruthy();

    const snapshot = JSON.parse(conv?.entity_snapshot as string) as {
      agent_name: string;
      project_name: string;
      project_id: string;
      agent_type: string;
    };
    expect(snapshot.agent_name).toBe('삭제될 에이전트');
    expect(snapshot.project_name).toBe('삭제대상 프로젝트');
    expect(snapshot.project_id).toBe(projectId);
    expect(snapshot.agent_type).toBe('dev-sub');
  });

  it('Given 존재하지 않는 Agent When 삭제하면 Then 404 AGENT_NOT_FOUND', async () => {
    await expect(service.delete(crypto.randomUUID())).rejects.toThrow(AppError);
    try {
      await service.delete(crypto.randomUUID());
    } catch (e) {
      expect((e as AppError).code).toBe('AGENT_NOT_FOUND');
    }
  });
});
