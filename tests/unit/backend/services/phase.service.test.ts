import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PhaseRepository } from '../../../../src/backend/repositories/phase.repository.js';
import { PhaseService } from '../../../../src/backend/services/phase.service.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import {
  createTestDb,
  isoNow,
  seedPhase,
  seedStages,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * PhaseService (FR-029 진행 추적 · WIP)
 *
 * 정의 원본: DES-004 v2.2 §18 · §전체 함수 시그니처 요약(PhaseService) ·
 * DES-002 v2.1 §5
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

function setStageStatus(stageId: string, status: string): void {
  testDb.db.prepare('UPDATE stages SET status = ? WHERE id = ?').run(status, stageId);
}

function insertWaiver(phaseId: string, rule: string): void {
  testDb.db
    .prepare('INSERT INTO wip_waivers (id, phase_id, rule, reason, created_at) VALUES (?,?,?,?,?)')
    .run(crypto.randomUUID(), phaseId, rule, '병행 사유', isoNow());
}

describe('PhaseService.create — Phase + 7단계 (R-01)', () => {
  it('Given 유효한 입력 When create하면 Then 7단계가 전부 pending으로 생성된다', async () => {
    const result = await service.create({ number: 2, name: '웹 대시보드' });

    expect(result.phase.number).toBe(2);
    expect(result.stages.length).toBe(7);
    expect(result.stages.every((s) => s.status === 'pending')).toBe(true);
    expect(result.stages.map((s) => s.skill)).toEqual([
      'plan',
      'analyze',
      'design',
      'develop',
      'test',
      'deploy',
      'operate',
    ]);
  });

  it('number < 1이면 400 VALIDATION_ERROR', async () => {
    await expect(service.create({ number: 0, name: '잘못된 번호' })).rejects.toThrow(AppError);
    try {
      await service.create({ number: 0, name: '잘못된 번호' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(400);
      expect((e as AppError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('number 중복이면 409 VALIDATION_ERROR', async () => {
    await service.create({ number: 3, name: '첫 Phase 3' });
    await expect(service.create({ number: 3, name: '두번째 Phase 3' })).rejects.toThrow(AppError);
    try {
      await service.create({ number: 3, name: '두번째 Phase 3' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(409);
    }
  });
});

describe('PhaseService.ensurePhase — 부트스트랩 멱등성', () => {
  it('두 번 호출해도 Phase 1행 · 단계 7행만 존재한다', async () => {
    const firstId = await service.ensurePhase(1, '기반 구축');
    const secondId = await service.ensurePhase(1, '기반 구축(다른 이름)');

    expect(secondId).toBe(firstId);

    const phaseCount = (
      testDb.db.prepare('SELECT COUNT(*) AS n FROM phases').get() as { n: number }
    ).n;
    const stageCount = (
      testDb.db.prepare('SELECT COUNT(*) AS n FROM stages WHERE phase_id = ?').get(firstId) as {
        n: number;
      }
    ).n;

    expect(phaseCount).toBe(1);
    expect(stageCount).toBe(7);
  });
});

describe('PhaseService.getCurrent', () => {
  it('진행 중 Phase가 없으면 404 NOT_FOUND', async () => {
    await expect(service.getCurrent()).rejects.toThrow(AppError);
    try {
      await service.getCurrent();
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });

  it('진행 중 Phase가 있으면 PhaseCurrent를 돌려준다', async () => {
    await service.create({ number: 5, name: '조회용 Phase' });
    const current = await service.getCurrent();
    expect(current.phase.number).toBe(5);
    expect(current.stages.length).toBe(7);
  });
});

describe('PhaseService — gate.required 파생 (CLAUDE.md 스킬 전환 모드 · DES-002 §5 예시)', () => {
  it('plan·test 단계만 gate.required가 true다', async () => {
    const current = await service.create({ number: 7, name: '게이트 파생 확인' });
    const requiredSkills = current.stages.filter((s) => s.gate.required).map((s) => s.skill);
    expect(requiredSkills.sort()).toEqual(['plan', 'test']);
  });
});

describe('PhaseService.checkWip', () => {
  it('in_progress가 1개 이하면 위반이 없다', async () => {
    const phaseId = seedPhase(testDb.db, { number: 1 });
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'in_progress');

    expect(await service.checkWip(phaseId)).toEqual([]);
  });

  it('in_progress가 2개 이상이면 위반 1건을 보고한다 (waived: false)', async () => {
    const phaseId = seedPhase(testDb.db, { number: 1 });
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'in_progress');
    setStageStatus(stages.analyze as string, 'in_progress');

    const violations = await service.checkWip(phaseId);
    expect(violations.length).toBe(1);
    expect(violations[0]?.rule).toBe('주요 단계 WIP = 1');
    expect(violations[0]?.waived).toBe(false);
  });

  it('면제가 등록되어 있어도 위반은 계속 보고하되 waived: true다 (감춤 금지)', async () => {
    const phaseId = seedPhase(testDb.db, { number: 1 });
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'in_progress');
    setStageStatus(stages.analyze as string, 'in_progress');
    insertWaiver(phaseId, '주요 단계 WIP = 1');

    const violations = await service.checkWip(phaseId);
    expect(violations.length).toBe(1);
    expect(violations[0]?.waived).toBe(true);
  });
});

describe('PhaseService.createWaiver', () => {
  it('reason이 빈 문자열이면 400 VALIDATION_ERROR', async () => {
    const phaseId = seedPhase(testDb.db, { number: 1 });
    await expect(
      service.createWaiver({ phaseId, rule: '주요 단계 WIP = 1', reason: '' }),
    ).rejects.toThrow(AppError);
  });

  it('reason이 공백뿐이면 400 VALIDATION_ERROR', async () => {
    const phaseId = seedPhase(testDb.db, { number: 1 });
    await expect(
      service.createWaiver({ phaseId, rule: '주요 단계 WIP = 1', reason: '   ' }),
    ).rejects.toThrow(AppError);
    try {
      await service.createWaiver({ phaseId, rule: '주요 단계 WIP = 1', reason: '   ' });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(400);
      expect((e as AppError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('유효한 사유면 저장되고, 이후 checkWip이 waived: true를 보고한다', async () => {
    const phaseId = seedPhase(testDb.db, { number: 1 });
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'in_progress');
    setStageStatus(stages.analyze as string, 'in_progress');

    await service.createWaiver({
      phaseId,
      rule: '주요 단계 WIP = 1',
      reason: '설계 개정과 API 명세를 병행',
    });

    const violations = await service.checkWip(phaseId);
    expect(violations[0]?.waived).toBe(true);
  });

  it('존재하지 않는 phaseId면 404 NOT_FOUND', async () => {
    await expect(
      service.createWaiver({
        phaseId: crypto.randomUUID(),
        rule: '주요 단계 WIP = 1',
        reason: '사유',
      }),
    ).rejects.toThrow(AppError);
    try {
      await service.createWaiver({
        phaseId: crypto.randomUUID(),
        rule: '주요 단계 WIP = 1',
        reason: '사유',
      });
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
    }
  });
});
