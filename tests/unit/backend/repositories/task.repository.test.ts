import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskRepository } from '../../../../src/backend/repositories/task.repository.js';
import {
  createTestDb,
  isoNow,
  seedAgent,
  seedProject,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * FR-008 — TaskRepository
 *
 * 정의 원본: DES-004 v2.2 §9~11 · §전체 함수 시그니처 요약 (Repositories)
 * DB 스키마: DES-003 v2.1 §2 (migrations/001_initial.sql)
 */

let testDb: TestDb;
let repo: TaskRepository;
let agentId: string;

beforeEach(() => {
  testDb = createTestDb();
  repo = new TaskRepository(testDb.db);
  const projectId = seedProject(testDb.db, { name: '기본 프로젝트' });
  agentId = seedAgent(testDb.db, projectId, { name: '기본 에이전트' });
});

afterEach(() => {
  testDb.close();
});

function insertRow(overrides: Partial<Parameters<TaskRepository['insert']>[0]> = {}) {
  const now = isoNow();
  return repo.insert({
    id: crypto.randomUUID(),
    agentId,
    title: 'Task A',
    description: '',
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe('TaskRepository.insert', () => {
  it('Given 유효한 입력 When insert하면 Then 저장된 행을 돌려준다', () => {
    const row = insertRow({ title: '작업-알파' });

    expect(row.title).toBe('작업-알파');
    expect(row.status).toBe('ready');
    expect(row.agent_id).toBe(agentId);
  });

  it('같은 제목이어도 중복이 허용된다 (유니크 제약 없음)', () => {
    insertRow({ title: '중복제목' });
    expect(() => insertRow({ title: '중복제목' })).not.toThrow();
  });
});

describe('TaskRepository.findById', () => {
  it('Given 존재하는 id When 조회하면 Then 행을 돌려준다', () => {
    const inserted = insertRow({ title: '베타' });
    const found = repo.findById(inserted.id);

    expect(found?.id).toBe(inserted.id);
    expect(found?.title).toBe('베타');
  });

  it('Given 존재하지 않는 id When 조회하면 Then null', () => {
    expect(repo.findById(crypto.randomUUID())).toBeNull();
  });
});

describe('TaskRepository.findActiveByAgentId', () => {
  it('ready·in_progress만 반환하고 in_review·completed·cancelled·skipped는 제외한다 (DES-007 §8)', () => {
    insertRow({ title: 'T-ready', status: 'ready' });
    insertRow({ title: 'T-in_progress', status: 'in_progress' });
    insertRow({ title: 'T-in_review', status: 'in_review' });
    insertRow({ title: 'T-completed', status: 'completed' });
    insertRow({ title: 'T-skipped', status: 'skipped' });

    const rows = repo.findActiveByAgentId(agentId);
    expect(rows.map((r) => r.title).sort()).toEqual(['T-in_progress', 'T-ready']);
  });
});

describe('TaskRepository.findMany · count', () => {
  it('Given Task가 3개 존재할 때 When 목록 조회하면 Then 3건 반환', () => {
    insertRow({ title: '목록-1' });
    insertRow({ title: '목록-2' });
    insertRow({ title: '목록-3' });

    const rows = repo.findMany({ offset: 0, limit: 20 });
    expect(rows.length).toBe(3);
    expect(repo.count({})).toBe(3);
  });

  it('agentId·status 필터가 적용된다', () => {
    insertRow({ title: '대기중', status: 'ready' });
    const inProgressId = crypto.randomUUID();
    insertRow({ title: '진행중', status: 'in_progress', id: inProgressId });

    const rows = repo.findMany({ offset: 0, limit: 20, agentId, status: 'in_progress' });
    expect(rows.map((r) => r.id)).toEqual([inProgressId]);
    expect(repo.count({ agentId, status: 'in_progress' })).toBe(1);
  });
});

describe('TaskRepository.updateStatus', () => {
  it('Given Task가 존재할 때 When updateStatus하면 Then status·updated_at이 갱신된다', () => {
    const inserted = insertRow({ status: 'ready' });
    const now = isoNow();

    const updated = repo.updateStatus(inserted.id, 'in_progress', now);

    expect(updated.status).toBe('in_progress');
    expect(updated.updated_at).toBe(now);
  });
});
