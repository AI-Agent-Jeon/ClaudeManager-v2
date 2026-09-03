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

// R2-01 (2026-09-03, 대표 결정) — 공개 API `async updateStatus()`는 삭제했다.
// D-1 이후 캐스케이드가 필요한 유일한 실사용 경로(`PATCH /api/projects/:id/status`)는
// `projects.routes.ts`가 `updateStatusSync()`를 직접 조율하므로, 이 래퍼는
// 호출하면 캐스케이드를 건너뛰는 함정(FIND-01·FIND-06과 같은 패턴)이었고
// `src/`·`tests/` 전체에 호출자가 0건이었다. 이 describe 블록은 동기 코어
// `updateStatusSync()`를 직접 호출하도록 옮겨, 삭제된 래퍼가 하던 것과 같은
// 동작(Project 자신의 전이 검증·이력 기록)을 계속 검증한다.
describe('ProjectService.updateStatusSync — FR-006', () => {
  it('Given 프로젝트가 ready 상태일 때 When running으로 변경하면 Then 상태가 갱신되고 이력이 기록된다', async () => {
    const created = await service.create({ name: '전이테스트' });

    const updated = service.updateStatusSync(created.id, 'running', new Date().toISOString());

    expect(updated.status).toBe('running');

    const rows = statusChangeRepo.findMany({ offset: 0, limit: 20, entityId: created.id });
    const latest = rows[rows.length - 1];
    expect(latest?.from_status).toBe('ready');
    expect(latest?.to_status).toBe('running');
  });

  it('Given 허용되지 않은 상태 전환일 때 When 상태 변경을 요청하면 Then 422 에러와 허용 전환 목록이 반환된다', async () => {
    const created = await service.create({ name: '불허전이' });

    const attempt = () =>
      service.updateStatusSync(created.id, 'completed', new Date().toISOString());
    expect(attempt).toThrow(AppError);
    try {
      attempt();
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
      expect((e as AppError).details?.allowedTransitions).toEqual(['running', 'cancelled']);
    }
  });

  it('Given 존재하지 않는 프로젝트 When 상태 변경하면 Then 404 PROJECT_NOT_FOUND', async () => {
    const attempt = () =>
      service.updateStatusSync(crypto.randomUUID(), 'running', new Date().toISOString());
    expect(attempt).toThrow(AppError);
    try {
      attempt();
    } catch (e) {
      expect((e as AppError).code).toBe('PROJECT_NOT_FOUND');
    }
  });

  // Project → Agent → Task 캐스케이드는 더 이상 ProjectService가 소유하지 않는다
  // (FIND-01 수정 · REV-M-01 — DES-001 v3.3 §레이어 규칙 10 "상태 전이·검증이
  // 붙은 쓰기는 Repository 직접 접근 예외 대상이 아니다"). `updateStatusSync`는
  // Project 자신의 전이만 처리한다 — 캐스케이드는 `projects.routes.ts`가
  // `db.transaction()` 안에서 `AgentService.cascadeFromProjectSync()`와
  // 조율한다(DES-001 §레이어 규칙 9). 캐스케이드 회귀·롤백·상태 머신 가드·
  // 감사 로그 테스트는 `tests/unit/backend/routes/project-cascade.test.ts`로
  // 옮겼다.
  it('Given Project가 running Agent를 가질 때 When cancelled로 전이해도 Then ProjectService 단독 호출은 Agent를 건드리지 않는다 (캐스케이드는 Route 소관)', async () => {
    const created = await service.create({ name: '캐스케이드-분리' });
    service.updateStatusSync(created.id, 'running', new Date().toISOString());
    const runningAgentId = seedAgent(testDb.db, created.id, { status: 'running' });

    service.updateStatusSync(created.id, 'cancelled', new Date().toISOString());

    expect(agentRepo.findById(runningAgentId)?.status).toBe('running');
  });
});
