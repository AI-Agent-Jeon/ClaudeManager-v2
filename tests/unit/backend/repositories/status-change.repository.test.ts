import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { createTestDb, isoNow, type TestDb } from '../../../fixtures/test-db.js';

/**
 * FR-009 상태 변경 이력 — StatusChangeRepository
 *
 * 정의 원본: DES-004 v2.2 §12 · §전체 함수 시그니처 요약
 * DB 스키마: DES-003 v2.1 §3-5 (entity_type CHECK 6종)
 */

let testDb: TestDb;
let repo: StatusChangeRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new StatusChangeRepository(testDb.db);
});

afterEach(() => {
  testDb.close();
});

describe('StatusChangeRepository.insert', () => {
  it('Given 상태 변경 정보 When insert하면 Then 조회 가능해진다', () => {
    const entityId = crypto.randomUUID();
    repo.insert({
      entityType: 'project',
      entityId,
      fromStatus: null,
      toStatus: 'ready',
      changedBy: 'system',
      changedAt: isoNow(),
    });

    const rows = repo.findMany({ offset: 0, limit: 20, entityId });
    expect(rows.length).toBe(1);
    expect(rows[0]?.from_status).toBeNull();
    expect(rows[0]?.to_status).toBe('ready');
  });
});

describe('StatusChangeRepository.findMany · count', () => {
  it('Given 여러 엔티티의 변경 이력이 있을 때 When entityType·entityId로 필터하면 Then 해당 건만 반환 (FR-009)', () => {
    const projectId = crypto.randomUUID();
    const agentId = crypto.randomUUID();
    const now = isoNow();

    repo.insert({
      entityType: 'project',
      entityId: projectId,
      fromStatus: null,
      toStatus: 'ready',
      changedBy: 'system',
      changedAt: now,
    });
    repo.insert({
      entityType: 'agent',
      entityId: agentId,
      fromStatus: null,
      toStatus: 'created',
      changedBy: 'system',
      changedAt: now,
    });

    const rows = repo.findMany({ offset: 0, limit: 20, entityType: 'agent' });
    expect(rows.length).toBe(1);
    expect(rows[0]?.entity_id).toBe(agentId);
    expect(repo.count({ entityType: 'agent' })).toBe(1);
    expect(repo.count({})).toBe(2);
  });

  it('시간순(changed_at ASC)으로 반환한다', () => {
    const entityId = crypto.randomUUID();
    repo.insert({
      entityType: 'project',
      entityId,
      fromStatus: null,
      toStatus: 'ready',
      changedBy: 'system',
      changedAt: '2026-01-01T00:00:00.000Z',
    });
    repo.insert({
      entityType: 'project',
      entityId,
      fromStatus: 'ready',
      toStatus: 'running',
      changedBy: 'user',
      changedAt: '2026-01-02T00:00:00.000Z',
    });

    const rows = repo.findMany({ offset: 0, limit: 20, entityId });
    expect(rows.map((r) => r.to_status)).toEqual(['ready', 'running']);
  });

  it('Given 이력이 없을 때 When 조회하면 Then 빈 배열', () => {
    expect(repo.findMany({ offset: 0, limit: 20 })).toEqual([]);
    expect(repo.count({})).toBe(0);
  });
});
