import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../../../src/backend/repositories/agent.repository.js';
import { ProjectRepository } from '../../../../src/backend/repositories/project.repository.js';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { ProjectService } from '../../../../src/backend/services/project.service.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import { createTestDb, seedAgent, type TestDb } from '../../../fixtures/test-db.js';

/**
 * FR-003 ~ FR-006 — ProjectService
 *
 * 정의 원본: DES-004 v2.2 §3~6 · §전체 함수 시그니처 요약 (Services)
 * 상태 머신: DES-007 v2.1 §2
 */

let testDb: TestDb;
let service: ProjectService;
let statusChangeRepo: StatusChangeRepository;
let agentRepo: AgentRepository;

beforeEach(() => {
  testDb = createTestDb();
  statusChangeRepo = new StatusChangeRepository(testDb.db);
  agentRepo = new AgentRepository(testDb.db);
  service = new ProjectService(new ProjectRepository(testDb.db), statusChangeRepo, agentRepo);
});

afterEach(() => {
  testDb.close();
});

describe('ProjectService.create — FR-003', () => {
  it('Given 인증된 상태일 때 When 이름과 설명을 제공하면 Then ready 상태로 생성된다', async () => {
    const project = await service.create({ name: '신규 프로젝트', description: '설명' });

    expect(project.status).toBe('ready');
    expect(project.name).toBe('신규 프로젝트');
    expect(project.description).toBe('설명');
    expect(project.id).toBeTruthy();
    expect(project.createdAt).toBe(project.updatedAt);
  });

  it('description 생략 시 빈 문자열로 저장된다 (DES-004 §3)', async () => {
    const project = await service.create({ name: '설명없음' });
    expect(project.description).toBe('');
  });

  it('Given 동일 이름의 프로젝트가 존재할 때 When 같은 이름으로 생성하면 Then 409 PROJECT_NAME_CONFLICT', async () => {
    await service.create({ name: '중복' });

    await expect(service.create({ name: '중복' })).rejects.toThrow(AppError);
    try {
      await service.create({ name: '중복' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(409);
      expect((e as AppError).code).toBe('PROJECT_NAME_CONFLICT');
    }
  });

  it('생성 시 status_changes에 fromStatus null → toStatus ready로 기록된다 (FR-009 · DES-004 §3)', async () => {
    const project = await service.create({ name: '이력확인' });

    const rows = statusChangeRepo.findMany({ offset: 0, limit: 20, entityId: project.id });
    expect(rows.length).toBe(1);
    expect(rows[0]?.from_status).toBeNull();
    expect(rows[0]?.to_status).toBe('ready');
    expect(rows[0]?.changed_by).toBe('system');
  });
});

describe('ProjectService.list — FR-004', () => {
  it('Given 프로젝트가 3개 존재할 때 When 목록 조회하면 Then 이름·상태·생성일을 포함한 3건이 반환된다', async () => {
    await service.create({ name: '목록-1' });
    await service.create({ name: '목록-2' });
    await service.create({ name: '목록-3' });

    const { items, pagination } = await service.list({ page: 1, pageSize: 20 });

    expect(items.length).toBe(3);
    expect(pagination.total).toBe(3);
    for (const item of items) {
      expect(item.name).toBeTruthy();
      expect(item.status).toBe('ready');
      expect(item.createdAt).toBeTruthy();
    }
  });

  it('Given 프로젝트가 없을 때 When 목록 조회하면 Then 빈 목록이 반환된다', async () => {
    const { items, pagination } = await service.list({ page: 1, pageSize: 20 });
    expect(items).toEqual([]);
    expect(pagination.total).toBe(0);
  });
});

describe('ProjectService.getById — FR-005', () => {
  it('Given 프로젝트가 존재할 때 When 상세 조회하면 Then 이름·설명·상태·생성일·Agent 목록이 반환된다', async () => {
    const created = await service.create({ name: '상세조회', description: '상세 설명' });
    const detail = await service.getById(created.id);

    expect(detail.name).toBe('상세조회');
    expect(detail.description).toBe('상세 설명');
    expect(detail.status).toBe('ready');
    expect(detail.createdAt).toBeTruthy();
    expect(detail.agents).toEqual([]);
  });

  it('Given 존재하지 않는 프로젝트 ID When 상세 조회하면 Then 404 PROJECT_NOT_FOUND', async () => {
    await expect(service.getById(crypto.randomUUID())).rejects.toThrow(AppError);
    try {
      await service.getById(crypto.randomUUID());
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('PROJECT_NOT_FOUND');
    }
  });

  it('Given 프로젝트에 Agent가 있을 때 When 상세 조회하면 Then agents가 채워진다 (DES-004 §5)', async () => {
    const created = await service.create({ name: 'Agent포함' });
    seedAgent(testDb.db, created.id, { name: '에이전트-A' });
    seedAgent(testDb.db, created.id, { name: '에이전트-B' });

    const detail = await service.getById(created.id);

    expect(detail.agents.length).toBe(2);
    expect(detail.agents.map((a) => a.name).sort()).toEqual(['에이전트-A', '에이전트-B']);
  });
});

describe('ProjectService.updateStatus — FR-006', () => {
  it('Given 프로젝트가 ready 상태일 때 When running으로 변경하면 Then 상태가 갱신되고 이력이 기록된다', async () => {
    const created = await service.create({ name: '전이테스트' });

    const updated = await service.updateStatus(created.id, 'running');

    expect(updated.status).toBe('running');

    const rows = statusChangeRepo.findMany({ offset: 0, limit: 20, entityId: created.id });
    const latest = rows[rows.length - 1];
    expect(latest?.from_status).toBe('ready');
    expect(latest?.to_status).toBe('running');
  });

  it('Given 허용되지 않은 상태 전환일 때 When 상태 변경을 요청하면 Then 422 에러와 허용 전환 목록이 반환된다', async () => {
    const created = await service.create({ name: '불허전이' });

    await expect(service.updateStatus(created.id, 'completed')).rejects.toThrow(AppError);
    try {
      await service.updateStatus(created.id, 'completed');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
      expect((e as AppError).details?.allowedTransitions).toEqual(['running', 'cancelled']);
    }
  });

  it('Given 존재하지 않는 프로젝트 When 상태 변경하면 Then 404 PROJECT_NOT_FOUND', async () => {
    await expect(service.updateStatus(crypto.randomUUID(), 'running')).rejects.toThrow(AppError);
    try {
      await service.updateStatus(crypto.randomUUID(), 'running');
    } catch (e) {
      expect((e as AppError).code).toBe('PROJECT_NOT_FOUND');
    }
  });

  it('Given Project가 running/waiting Agent를 가질 때 When cancelled로 전이하면 Then 소속 Agent가 일괄 cancelled된다 (DES-007 §8)', async () => {
    const created = await service.create({ name: '캐스케이드-취소' });
    await service.updateStatus(created.id, 'running');
    const runningAgentId = seedAgent(testDb.db, created.id, { status: 'running' });
    const waitingAgentId = seedAgent(testDb.db, created.id, { status: 'waiting' });
    const createdAgentId = seedAgent(testDb.db, created.id, { status: 'created' });

    await service.updateStatus(created.id, 'cancelled');

    expect(agentRepo.findById(runningAgentId)?.status).toBe('cancelled');
    expect(agentRepo.findById(waitingAgentId)?.status).toBe('cancelled');
    // created는 "실행 중/대기 중"이 아니라 캐스케이드 대상이 아니다
    expect(agentRepo.findById(createdAgentId)?.status).toBe('created');
  });

  it('Given Project가 running Agent를 가질 때 When paused로 전이하면 Then running Agent만 paused된다 (DES-007 §8)', async () => {
    const created = await service.create({ name: '캐스케이드-일시정지' });
    await service.updateStatus(created.id, 'running');
    const runningAgentId = seedAgent(testDb.db, created.id, { status: 'running' });
    const waitingAgentId = seedAgent(testDb.db, created.id, { status: 'waiting' });

    await service.updateStatus(created.id, 'paused');

    expect(agentRepo.findById(runningAgentId)?.status).toBe('paused');
    // waiting → paused는 AGENT_TRANSITIONS에 없어 캐스케이드에서 제외된다
    expect(agentRepo.findById(waitingAgentId)?.status).toBe('waiting');
  });
});
