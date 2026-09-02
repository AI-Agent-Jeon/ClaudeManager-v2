import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../../../src/backend/repositories/agent.repository.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import { createTestDb, isoNow, seedProject, type TestDb } from '../../../fixtures/test-db.js';

/**
 * FR-007 — AgentRepository
 *
 * 정의 원본: DES-004 v2.2 §7~8·§13 · §전체 함수 시그니처 요약 (Repositories)
 * DB 스키마: DES-003 v2.1 §2 (migrations/001_initial.sql — UNIQUE(project_id, name))
 */

let testDb: TestDb;
let repo: AgentRepository;
let projectId: string;

beforeEach(() => {
  testDb = createTestDb();
  repo = new AgentRepository(testDb.db);
  projectId = seedProject(testDb.db, { name: '기본 프로젝트' });
});

afterEach(() => {
  testDb.close();
});

function insertRow(overrides: Partial<Parameters<AgentRepository['insert']>[0]> = {}) {
  const now = isoNow();
  return repo.insert({
    id: crypto.randomUUID(),
    projectId,
    name: '에이전트 A',
    type: '',
    status: 'created',
    waitingReason: null,
    skill: '',
    config: '{}',
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe('AgentRepository.insert', () => {
  it('Given 유효한 입력 When insert하면 Then 저장된 행을 돌려준다', () => {
    const row = insertRow({ name: '알파' });

    expect(row.name).toBe('알파');
    expect(row.status).toBe('created');
    expect(row.project_id).toBe(projectId);
  });

  it('Given 동일 프로젝트에 같은 이름의 Agent가 있을 때 When insert하면 Then 409 AGENT_NAME_CONFLICT', () => {
    insertRow({ name: '중복이름' });

    expect(() => insertRow({ name: '중복이름' })).toThrow(AppError);
    try {
      insertRow({ name: '중복이름' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(409);
      expect((e as AppError).code).toBe('AGENT_NAME_CONFLICT');
    }
  });

  it('다른 프로젝트라면 같은 이름이어도 허용된다 (프로젝트 내 유니크)', () => {
    const otherProjectId = seedProject(testDb.db, { name: '다른 프로젝트' });
    insertRow({ name: '중복가능' });

    expect(() =>
      repo.insert({
        id: crypto.randomUUID(),
        projectId: otherProjectId,
        name: '중복가능',
        type: '',
        status: 'created',
        waitingReason: null,
        skill: '',
        config: '{}',
        retryCount: 0,
        createdAt: isoNow(),
        updatedAt: isoNow(),
      }),
    ).not.toThrow();
  });
});

describe('AgentRepository.findById', () => {
  it('Given 존재하는 id When 조회하면 Then 행을 돌려준다', () => {
    const inserted = insertRow({ name: '베타' });
    const found = repo.findById(inserted.id);

    expect(found?.id).toBe(inserted.id);
    expect(found?.name).toBe('베타');
  });

  it('Given 존재하지 않는 id When 조회하면 Then null', () => {
    expect(repo.findById(crypto.randomUUID())).toBeNull();
  });
});

describe('AgentRepository.findByProjectId', () => {
  it('Given 프로젝트에 Agent가 2개 있을 때 When 조회하면 Then 페이지네이션 없이 전건 반환 (DES-004 §5)', () => {
    insertRow({ name: '에이전트-1' });
    insertRow({ name: '에이전트-2' });
    const otherProjectId = seedProject(testDb.db, { name: '다른 프로젝트' });
    repo.insert({
      id: crypto.randomUUID(),
      projectId: otherProjectId,
      name: '다른프로젝트-에이전트',
      type: '',
      status: 'created',
      waitingReason: null,
      skill: '',
      config: '{}',
      retryCount: 0,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    });

    const rows = repo.findByProjectId(projectId);
    expect(rows.length).toBe(2);
  });
});

describe('AgentRepository.findActiveByProjectId', () => {
  it('running·waiting만 반환하고 created·paused·completed·cancelled는 제외한다 (DES-007 §8)', () => {
    insertRow({ name: 'A-running', status: 'running' });
    insertRow({ name: 'A-waiting', status: 'waiting' });
    insertRow({ name: 'A-created', status: 'created' });
    insertRow({ name: 'A-paused', status: 'paused' });
    insertRow({ name: 'A-completed', status: 'completed' });

    const rows = repo.findActiveByProjectId(projectId);
    expect(rows.map((r) => r.name).sort()).toEqual(['A-running', 'A-waiting']);
  });
});

describe('AgentRepository.findMany · count', () => {
  it('Given Agent가 3개 존재할 때 When 목록 조회하면 Then 3건 반환', () => {
    insertRow({ name: '목록-1' });
    insertRow({ name: '목록-2' });
    insertRow({ name: '목록-3' });

    const rows = repo.findMany({ offset: 0, limit: 20 });
    expect(rows.length).toBe(3);
    expect(repo.count({})).toBe(3);
  });

  it('projectId·status 필터가 적용된다', () => {
    insertRow({ name: '준비중', status: 'created' });
    const runningId = crypto.randomUUID();
    insertRow({ name: '실행중', status: 'running', id: runningId });

    const rows = repo.findMany({ offset: 0, limit: 20, projectId, status: 'running' });
    expect(rows.map((r) => r.id)).toEqual([runningId]);
    expect(repo.count({ projectId, status: 'running' })).toBe(1);
  });
});

describe('AgentRepository.updateStatus', () => {
  it('Given Agent가 존재할 때 When updateStatus하면 Then status가 갱신되고 waiting_reason은 NULL로 초기화된다', () => {
    const inserted = insertRow({ status: 'created' });
    const now = isoNow();

    const updated = repo.updateStatus(inserted.id, 'running', null, now);

    expect(updated.status).toBe('running');
    expect(updated.updated_at).toBe(now);
    expect(updated.waiting_reason).toBeNull();
  });

  it('status가 waiting이면 전달된 waitingReason이 저장된다 (v2.6 · Layer 2-6)', () => {
    const inserted = insertRow({ status: 'running' });
    const now = isoNow();

    const updated = repo.updateStatus(inserted.id, 'waiting', 'ceo_approval', now);

    expect(updated.status).toBe('waiting');
    expect(updated.waiting_reason).toBe('ceo_approval');
  });

  it('status가 waiting이 아니면 waitingReason을 넘겨도 NULL로 강제된다 (DB CHECK와 동일 규칙)', () => {
    const inserted = insertRow({ status: 'waiting', waitingReason: 'ceo_decision' });
    const now = isoNow();

    const updated = repo.updateStatus(inserted.id, 'running', 'ceo_approval', now);

    expect(updated.status).toBe('running');
    expect(updated.waiting_reason).toBeNull();
  });
});

describe('AgentRepository.deleteById', () => {
  it('Given Agent가 존재할 때 When 삭제하면 Then 더 이상 조회되지 않는다', () => {
    const inserted = insertRow();
    repo.deleteById(inserted.id);
    expect(repo.findById(inserted.id)).toBeNull();
  });
});
