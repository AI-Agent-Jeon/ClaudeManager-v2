import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectRepository } from '../../../../src/backend/repositories/project.repository.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import { createTestDb, isoNow, type TestDb } from '../../../fixtures/test-db.js';

/**
 * FR-003 ~ FR-006 — ProjectRepository
 *
 * 정의 원본: DES-004 v2.2 §전체 함수 시그니처 요약 (Repositories)
 * DB 스키마: DES-003 v2.1 §2 (migrations/001_initial.sql)
 */

let testDb: TestDb;
let repo: ProjectRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new ProjectRepository(testDb.db);
});

afterEach(() => {
  testDb.close();
});

function insertRow(overrides: Partial<Parameters<ProjectRepository['insert']>[0]> = {}) {
  const now = isoNow();
  return repo.insert({
    id: crypto.randomUUID(),
    name: '프로젝트 A',
    description: '',
    status: 'ready',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe('ProjectRepository.insert', () => {
  it('Given 유효한 입력 When insert하면 Then 저장된 행을 돌려준다', () => {
    const row = insertRow({ name: '알파' });

    expect(row.name).toBe('알파');
    expect(row.status).toBe('ready');
  });

  it('Given 동일 이름의 프로젝트가 존재할 때 When 같은 이름으로 insert하면 Then PROJECT_NAME_CONFLICT (FR-003)', () => {
    insertRow({ name: '중복이름' });

    expect(() => insertRow({ name: '중복이름' })).toThrow(AppError);
    try {
      insertRow({ name: '중복이름' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(409);
      expect((e as AppError).code).toBe('PROJECT_NAME_CONFLICT');
    }
  });
});

describe('ProjectRepository.findById', () => {
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

describe('ProjectRepository.findMany · count', () => {
  it('Given 프로젝트가 3개 존재할 때 When 목록 조회하면 Then 3건 반환 (FR-004)', () => {
    insertRow({ name: '목록-1' });
    insertRow({ name: '목록-2' });
    insertRow({ name: '목록-3' });

    const rows = repo.findMany({ offset: 0, limit: 20 });
    expect(rows.length).toBe(3);
    expect(repo.count({})).toBe(3);
  });

  it('Given 프로젝트가 없을 때 When 목록 조회하면 Then 빈 배열 (FR-004)', () => {
    expect(repo.findMany({ offset: 0, limit: 20 })).toEqual([]);
    expect(repo.count({})).toBe(0);
  });

  it('status 필터가 적용된다', () => {
    insertRow({ name: '준비중', status: 'ready' });
    const runningId = crypto.randomUUID();
    insertRow({ name: '실행중', status: 'running', id: runningId });

    const rows = repo.findMany({ offset: 0, limit: 20, status: 'running' });
    expect(rows.map((r) => r.id)).toEqual([runningId]);
    expect(repo.count({ status: 'running' })).toBe(1);
  });

  it('offset·limit이 적용된다', () => {
    for (let i = 0; i < 5; i++) {
      insertRow({ name: `페이지-${i}` });
    }
    expect(repo.findMany({ offset: 0, limit: 2 }).length).toBe(2);
    expect(repo.findMany({ offset: 4, limit: 2 }).length).toBe(1);
  });
});

describe('ProjectRepository.updateStatus', () => {
  it('Given 프로젝트가 존재할 때 When updateStatus하면 Then status·updated_at이 갱신된다 (FR-006)', () => {
    const inserted = insertRow({ status: 'ready' });
    const now = isoNow();

    const updated = repo.updateStatus(inserted.id, 'running', now);

    expect(updated.status).toBe('running');
    expect(updated.updated_at).toBe(now);
  });
});
