import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PhaseRepository } from '../../../../src/backend/repositories/phase.repository.js';
import { PhaseService } from '../../../../src/backend/services/phase.service.js';
import { createTestDb, type TestDb } from '../../../fixtures/test-db.js';

/**
 * PhaseService.create 트랜잭션 원자성 — DES-004 v2.2 §18 · 개발 지시 §3
 *
 * 왜 필요한가: `POST /api/phases`는 Phase 행 + 7단계를 한 트랜잭션으로 만든다
 * (`UNIQUE(phase_id, skill)`가 Phase당 정확히 7행을 요구하므로, 도중에
 * 실패하면 6행/8행짜리 Phase가 남아서는 안 된다). `approval-atomicity.test.ts`
 * (Layer 2-6)를 본떠, 실제 SQLite 롤백을 목킹 없이 검증한다.
 */

let testDb: TestDb;
let service: PhaseService;
let repo: PhaseRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new PhaseRepository(testDb.db);
  service = new PhaseService(testDb.db, repo);
});

afterEach(() => {
  testDb.close();
});

const countPhases = () =>
  (testDb.db.prepare('SELECT COUNT(*) AS n FROM phases').get() as { n: number }).n;
const countStages = () =>
  (testDb.db.prepare('SELECT COUNT(*) AS n FROM stages').get() as { n: number }).n;

describe('PhaseService.create 원자성', () => {
  it('7단계 중간에 INSERT가 실패하면 phases도 함께 롤백된다 (6행짜리 Phase가 남지 않는다)', async () => {
    const original = testDb.db.prepare.bind(testDb.db);
    let stageInsertCalls = 0;
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (testDb.db as any).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO stages')) {
        stageInsertCalls += 1;
        // 4번째 단계(develop) INSERT에서 실패를 주입한다 — plan·analyze·design까지는
        // 성공했다는 뜻이므로, 롤백 없이는 3행짜리 stages가 남는다
        if (stageInsertCalls === 4) {
          throw new Error('4번째 단계 INSERT 실패 시뮬레이션');
        }
      }
      return original(sql);
    };

    await expect(service.create({ number: 9, name: '원자성 확인용' })).rejects.toThrow(
      '4번째 단계 INSERT 실패 시뮬레이션',
    );

    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치 복원
    (testDb.db as any).prepare = original;
    expect(countPhases()).toBe(0);
    expect(countStages()).toBe(0);
  });

  it('phases INSERT 자체가 실패하면 stages는 애초에 만들어지지 않는다', async () => {
    const original = testDb.db.prepare.bind(testDb.db);
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (testDb.db as any).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO phases')) {
        throw new Error('phases INSERT 실패 시뮬레이션');
      }
      return original(sql);
    };

    await expect(service.create({ number: 10, name: '원자성 확인용 2' })).rejects.toThrow(
      'phases INSERT 실패 시뮬레이션',
    );

    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치 복원
    (testDb.db as any).prepare = original;
    expect(countPhases()).toBe(0);
    expect(countStages()).toBe(0);
  });
});
