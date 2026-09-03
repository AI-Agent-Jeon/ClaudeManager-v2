import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PhaseRepository } from '../../../../src/backend/repositories/phase.repository.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import {
  createTestDb,
  isoNow,
  seedPhase,
  seedStages,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * PhaseRepository (FR-029)
 *
 * 정의 원본: DES-004 v2.2 §18 · §전체 함수 시그니처 요약(PhaseService) ·
 * DES-003 v2.1 §4-2·§4-3·§4-5
 */

let testDb: TestDb;
let repo: PhaseRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new PhaseRepository(testDb.db);
});

afterEach(() => {
  testDb.close();
});

/** 이 계층 전용 로컬 헬퍼 — artifacts·approvals·wip_waivers를 직접 심는다 */
function insertArtifact(stageId: string, code: string): void {
  testDb.db
    .prepare(
      `INSERT INTO artifacts (id, stage_id, code, title, status, notion_url, git_path, updated_at)
       VALUES (?, ?, ?, ?, 'draft', NULL, NULL, ?)`,
    )
    .run(crypto.randomUUID(), stageId, code, code, isoNow());
}

function insertApproval(
  stageId: string,
  overrides: { approvalType?: string; status?: string; createdAt?: string } = {},
): string {
  const id = crypto.randomUUID();
  const status = overrides.status ?? 'pending';
  // approvals CHECK 제약(DES-003 §4-1): 처리된 건은 resolved_at 필수(5),
  // rejected·conditional은 reason 필수(3) — 헬퍼가 상태에 맞춰 자동으로 채운다.
  const reason = status === 'rejected' || status === 'conditional' ? '테스트 사유' : null;
  const resolvedAt = status === 'pending' ? null : isoNow();
  testDb.db
    .prepare(
      `INSERT INTO approvals (id, message_id, stage_id, approval_type, level, subject, options,
         artifacts, rationale, impact, requested_by, deadline_at, status, resolution, reason,
         resolved_at, created_at)
       VALUES (?, NULL, ?, ?, 'high', '테스트 안건', '[]', NULL, NULL, NULL, 'main', NULL, ?, NULL, ?, ?, ?)`,
    )
    .run(
      id,
      stageId,
      overrides.approvalType ?? 'APV-GATE',
      status,
      reason,
      resolvedAt,
      overrides.createdAt ?? isoNow(),
    );
  return id;
}

function setStageStatus(stageId: string, status: string): void {
  testDb.db.prepare('UPDATE stages SET status = ? WHERE id = ?').run(status, stageId);
}

describe('PhaseRepository.insertPhase / findPhaseById / findPhaseByNumber', () => {
  it('Given 유효한 입력 When insertPhase하면 Then 저장된 행을 돌려준다', () => {
    const row = repo.insertPhase({
      id: crypto.randomUUID(),
      number: 1,
      name: '기반 구축',
      startedAt: isoNow(),
    });
    expect(row.number).toBe(1);
    expect(row.name).toBe('기반 구축');
    expect(repo.findPhaseById(row.id)?.id).toBe(row.id);
    expect(repo.findPhaseByNumber(1)?.id).toBe(row.id);
  });

  it('number 중복 시 409 VALIDATION_ERROR (phases_number_unique)', () => {
    repo.insertPhase({ id: crypto.randomUUID(), number: 1, name: 'A', startedAt: isoNow() });
    const insertDup = () =>
      repo.insertPhase({ id: crypto.randomUUID(), number: 1, name: 'B', startedAt: isoNow() });

    expect(insertDup).toThrow(AppError);
    try {
      insertDup();
    } catch (e) {
      expect((e as AppError).statusCode).toBe(409);
      expect((e as AppError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('존재하지 않는 id·number 조회 시 null', () => {
    expect(repo.findPhaseById(crypto.randomUUID())).toBeNull();
    expect(repo.findPhaseByNumber(999)).toBeNull();
  });
});

describe('PhaseRepository.upsertPhaseIgnoreConflict / upsertStageIgnoreConflict — 멱등', () => {
  it('같은 number로 두 번 호출해도 1행만 남는다 (예외를 던지지 않는다)', () => {
    const first = repo.upsertPhaseIgnoreConflict({
      id: crypto.randomUUID(),
      number: 1,
      name: '기반 구축',
      startedAt: isoNow(),
    });
    const second = repo.upsertPhaseIgnoreConflict({
      id: crypto.randomUUID(),
      number: 1,
      name: '다른 이름',
      startedAt: isoNow(),
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('기반 구축'); // 최초 값 유지 — DO NOTHING
    const count = (testDb.db.prepare('SELECT COUNT(*) AS n FROM phases').get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it('같은 (phase_id, skill)로 두 번 호출해도 stages 행이 늘지 않는다', () => {
    const phase = repo.upsertPhaseIgnoreConflict({
      id: crypto.randomUUID(),
      number: 1,
      name: '기반 구축',
      startedAt: isoNow(),
    });
    repo.upsertStageIgnoreConflict({ id: crypto.randomUUID(), phaseId: phase.id, skill: 'plan' });
    repo.upsertStageIgnoreConflict({ id: crypto.randomUUID(), phaseId: phase.id, skill: 'plan' });

    const count = (
      testDb.db.prepare('SELECT COUNT(*) AS n FROM stages WHERE phase_id = ?').get(phase.id) as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });
});

describe('PhaseRepository.findCurrentPhase', () => {
  it('completed_at이 NULL인 Phase가 없으면 null', () => {
    expect(repo.findCurrentPhase()).toBeNull();
  });

  it('completed_at이 NULL인 Phase 중 번호가 가장 큰 것을 돌려준다', () => {
    seedPhase(testDb.db, { number: 1 });
    const two = seedPhase(testDb.db, { number: 2 });

    const current = repo.findCurrentPhase();
    expect(current?.id).toBe(two);
  });
});

describe('PhaseRepository.findStagesWithAggregates — 교차 애그리거트 집계 (N+1 방지)', () => {
  it('artifactCount·pendingApprovalCount가 0인 기본값을 돌려준다', () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);

    const rows = repo.findStagesWithAggregates(phaseId);
    expect(rows.length).toBe(7);
    const plan = rows.find((r) => r.id === stages.plan);
    expect(plan?.artifact_count).toBe(0);
    expect(plan?.pending_approval_count).toBe(0);
    expect(plan?.gate_approval_id).toBeNull();
    expect(plan?.gate_status).toBeNull();
  });

  it('artifacts·approvals가 있으면 단계별로 정확히 집계된다', () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);

    insertArtifact(stages.plan as string, 'PLN-001');
    insertArtifact(stages.plan as string, 'PLN-002');
    insertApproval(stages.plan as string, { approvalType: 'APV-CHOICE', status: 'pending' });
    insertApproval(stages.plan as string, { approvalType: 'APV-CHOICE', status: 'approved' });

    const rows = repo.findStagesWithAggregates(phaseId);
    const plan = rows.find((r) => r.id === stages.plan);
    const analyze = rows.find((r) => r.id === stages.analyze);

    expect(plan?.artifact_count).toBe(2);
    expect(plan?.pending_approval_count).toBe(1); // approved 건은 제외
    expect(analyze?.artifact_count).toBe(0);
  });

  it('단계별 최신 APV-GATE 승인 1건만 gate_approval_id·gate_status에 채운다', () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);

    insertApproval(stages.plan as string, {
      approvalType: 'APV-GATE',
      status: 'rejected',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const latest = insertApproval(stages.plan as string, {
      approvalType: 'APV-GATE',
      status: 'approved',
      createdAt: '2026-09-02T00:00:00.000Z',
    });

    const rows = repo.findStagesWithAggregates(phaseId);
    const plan = rows.find((r) => r.id === stages.plan);
    expect(plan?.gate_approval_id).toBe(latest);
    expect(plan?.gate_status).toBe('approved');
  });

  it('한 번의 쿼리로 7단계를 전부 가져온다 (N+1 없음)', () => {
    const phaseId = seedPhase(testDb.db);
    seedStages(testDb.db, phaseId);

    let prepareCalls = 0;
    const original = testDb.db.prepare.bind(testDb.db);
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 계측
    (testDb.db as any).prepare = (sql: string) => {
      prepareCalls += 1;
      return original(sql);
    };

    repo.findStagesWithAggregates(phaseId);

    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 계측 복원
    (testDb.db as any).prepare = original;
    expect(prepareCalls).toBe(1);
  });
});

describe('PhaseRepository.countInProgressStages', () => {
  it('in_progress 상태인 단계 수를 센다', () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'in_progress');
    setStageStatus(stages.analyze as string, 'in_progress');

    expect(repo.countInProgressStages(phaseId)).toBe(2);
  });

  it('in_progress가 없으면 0', () => {
    const phaseId = seedPhase(testDb.db);
    seedStages(testDb.db, phaseId);
    expect(repo.countInProgressStages(phaseId)).toBe(0);
  });
});

describe('PhaseRepository.findWaiver / insertWaiver', () => {
  it('면제 기록이 없으면 null', () => {
    const phaseId = seedPhase(testDb.db);
    expect(repo.findWaiver(phaseId, '주요 단계 WIP = 1')).toBeNull();
  });

  it('insertWaiver 후 findWaiver로 조회된다', () => {
    const phaseId = seedPhase(testDb.db);
    const row = repo.insertWaiver({
      id: crypto.randomUUID(),
      phaseId,
      rule: '주요 단계 WIP = 1',
      reason: '설계 개정과 API 명세를 병행',
      createdAt: isoNow(),
    });

    expect(row.reason).toBe('설계 개정과 API 명세를 병행');
    expect(repo.findWaiver(phaseId, '주요 단계 WIP = 1')?.id).toBe(row.id);
  });

  it('존재하지 않는 phaseId로 insertWaiver하면 404 NOT_FOUND (FK 위반 변환)', () => {
    const insert = () =>
      repo.insertWaiver({
        id: crypto.randomUUID(),
        phaseId: crypto.randomUUID(),
        rule: '주요 단계 WIP = 1',
        reason: '사유',
        createdAt: isoNow(),
      });

    expect(insert).toThrow(AppError);
    try {
      insert();
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('NOT_FOUND');
    }
  });

  it('reason이 공백뿐이면 400 VALIDATION_ERROR (CHECK 위반이 500으로 새지 않는다)', () => {
    const phaseId = seedPhase(testDb.db);
    const insert = () =>
      repo.insertWaiver({
        id: crypto.randomUUID(),
        phaseId,
        rule: '주요 단계 WIP = 1',
        reason: '   ',
        createdAt: isoNow(),
      });

    expect(insert).toThrow(AppError);
    try {
      insert();
    } catch (e) {
      expect((e as AppError).statusCode).toBe(400);
      expect((e as AppError).code).toBe('VALIDATION_ERROR');
    }
  });
});
