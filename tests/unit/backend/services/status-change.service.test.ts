import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { StatusChangeService } from '../../../../src/backend/services/status-change.service.js';
import { createTestDb, isoNow, type TestDb } from '../../../fixtures/test-db.js';

/**
 * FR-009 상태 변경 이력 — StatusChangeService
 *
 * 정의 원본: DES-004 v2.2 §12 · §전체 함수 시그니처 요약 (Services)
 */

let testDb: TestDb;
let service: StatusChangeService;

beforeEach(() => {
  testDb = createTestDb();
  service = new StatusChangeService(new StatusChangeRepository(testDb.db));
});

afterEach(() => {
  testDb.close();
});

describe('StatusChangeService.record', () => {
  it('Given 상태 변경 정보 When record하면 Then 이력에 기록된다', async () => {
    const entityId = crypto.randomUUID();
    await service.record({
      entityType: 'project',
      entityId,
      fromStatus: null,
      toStatus: 'ready',
      changedBy: 'system',
      changedAt: isoNow(),
    });

    const { items } = await service.list({ page: 1, pageSize: 20, entityId });
    expect(items.length).toBe(1);
    expect(items[0]?.toStatus).toBe('ready');
    expect(items[0]?.fromStatus).toBeNull();
  });
});

describe('StatusChangeService.list', () => {
  it('Given 엔티티 상태가 여러 번 변경될 때 When 이력을 조회하면 Then 시간순으로 전건 반환 (FR-009)', async () => {
    const entityId = crypto.randomUUID();
    await service.record({
      entityType: 'project',
      entityId,
      fromStatus: null,
      toStatus: 'ready',
      changedBy: 'system',
      changedAt: '2026-01-01T00:00:00.000Z',
    });
    await service.record({
      entityType: 'project',
      entityId,
      fromStatus: 'ready',
      toStatus: 'running',
      changedBy: 'user',
      changedAt: '2026-01-02T00:00:00.000Z',
    });

    const { items, pagination } = await service.list({ page: 1, pageSize: 20, entityId });
    expect(items.map((i) => i.toStatus)).toEqual(['ready', 'running']);
    expect(pagination.total).toBe(2);
  });

  it('pagination을 계산한다', async () => {
    for (let i = 0; i < 3; i++) {
      await service.record({
        entityType: 'project',
        entityId: crypto.randomUUID(),
        fromStatus: null,
        toStatus: 'ready',
        changedBy: 'system',
        changedAt: isoNow(),
      });
    }

    const { pagination } = await service.list({ page: 1, pageSize: 2 });
    expect(pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });
});
