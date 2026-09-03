import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalRepository } from '../../../../src/backend/repositories/approval.repository.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import {
  createTestDb,
  isoNow,
  seedApproval,
  seedPhase,
  seedStages,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * ApprovalRepository (FR-028 · FR-030)
 *
 * 정의 원본: DES-004 v2.4 §15~17 · DES-003 v2.1 §4-1 (CHECK 제약 5건)
 */

let testDb: TestDb;
let repo: ApprovalRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new ApprovalRepository(testDb.db);
});

afterEach(() => {
  testDb.close();
});

describe('ApprovalRepository.insert / findById', () => {
  it('Given 유효한 입력 When insert하면 Then 저장된 행을 돌려준다', () => {
    const row = repo.insert({
      id: crypto.randomUUID(),
      messageId: null,
      stageId: null,
      approvalType: 'APV-CHOICE',
      level: 'medium',
      subject: '테스트 안건',
      options: JSON.stringify([{ code: 'A', label: '승인' }]),
      artifacts: null,
      rationale: null,
      impact: null,
      requestedBy: 'main',
      deadlineAt: isoNow(),
      createdAt: isoNow(),
    });

    expect(row.subject).toBe('테스트 안건');
    expect(row.status).toBe('pending');
    expect(repo.findById(row.id)?.id).toBe(row.id);
  });

  it('존재하지 않는 stageId로 insert하면 404 STAGE_NOT_FOUND (FK 위반 변환)', () => {
    const insert = () =>
      repo.insert({
        id: crypto.randomUUID(),
        messageId: null,
        stageId: crypto.randomUUID(),
        approvalType: 'APV-GATE',
        level: 'high',
        subject: '게이트',
        options: JSON.stringify([{ code: 'A', label: '승인' }]),
        artifacts: null,
        rationale: null,
        impact: null,
        requestedBy: 'main',
        deadlineAt: null,
        createdAt: isoNow(),
      });

    expect(insert).toThrow(AppError);
    try {
      insert();
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('STAGE_NOT_FOUND');
    }
  });

  it('존재하지 않는 id 조회 시 null', () => {
    expect(repo.findById(crypto.randomUUID())).toBeNull();
  });
});

describe('ApprovalRepository.findMany — 필터·정렬', () => {
  it('status로 필터링된다', () => {
    seedApproval(testDb.db, { status: 'pending', level: 'high' });
    seedApproval(testDb.db, { status: 'approved', level: 'high', resolvedAt: isoNow() });

    const rows = repo.findMany({ status: 'pending' });
    expect(rows.length).toBe(1);
    expect(rows[0]?.status).toBe('pending');
  });

  it('level로 필터링된다', () => {
    seedApproval(testDb.db, { level: 'high' });
    seedApproval(testDb.db, { level: 'medium' });

    const rows = repo.findMany({ level: 'medium' });
    expect(rows.length).toBe(1);
    expect(rows[0]?.level).toBe('medium');
  });

  it('type으로 필터링된다', () => {
    seedApproval(testDb.db, { approvalType: 'APV-CHOICE' });
    seedApproval(testDb.db, { approvalType: 'APV-ARCH' });

    const rows = repo.findMany({ type: 'APV-ARCH' });
    expect(rows.length).toBe(1);
    expect(rows[0]?.approval_type).toBe('APV-ARCH');
  });

  it("sort='created'는 최신순이다", async () => {
    const first = seedApproval(testDb.db, { createdAt: '2026-09-01T00:00:00.000Z' });
    const second = seedApproval(testDb.db, { createdAt: '2026-09-02T00:00:00.000Z' });

    const rows = repo.findMany({ sort: 'created' });
    expect(rows.map((r) => r.id)).toEqual([second, first]);
  });

  it("sort='deadline'(기본)은 기한 임박 순이고, 기한이 없는 건(high)은 뒤로 간다", () => {
    const noDeadline = seedApproval(testDb.db, {
      level: 'high',
      deadlineAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const soon = seedApproval(testDb.db, {
      level: 'medium',
      deadlineAt: '2026-09-01T00:10:00.000Z',
    });
    const later = seedApproval(testDb.db, {
      level: 'medium',
      deadlineAt: '2026-09-01T01:00:00.000Z',
    });

    const rows = repo.findMany({ sort: 'deadline' });
    expect(rows.map((r) => r.id)).toEqual([soon, later, noDeadline]);
  });
});

describe('ApprovalRepository.findExpired', () => {
  it('pending이고 기한이 지난 건만 돌려준다 — high(무기한)는 제외된다', () => {
    const expired = seedApproval(testDb.db, {
      level: 'medium',
      status: 'pending',
      deadlineAt: '2026-09-01T00:00:00.000Z',
    });
    seedApproval(testDb.db, {
      level: 'medium',
      status: 'pending',
      deadlineAt: '2099-01-01T00:00:00.000Z',
    });
    seedApproval(testDb.db, { level: 'high', status: 'pending', deadlineAt: null });

    const rows = repo.findExpired('2026-09-02T00:00:00.000Z');
    expect(rows.map((r) => r.id)).toEqual([expired]);
  });
});

describe('ApprovalRepository.findLatestGateByStage', () => {
  it('해당 단계의 최신 APV-GATE 승인 1건을 돌려준다', () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    const stageId = stages.design as string;

    seedApproval(testDb.db, {
      stageId,
      approvalType: 'APV-GATE',
      level: 'high',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const latest = seedApproval(testDb.db, {
      stageId,
      approvalType: 'APV-GATE',
      level: 'high',
      createdAt: '2026-09-02T00:00:00.000Z',
    });
    // 다른 단계의 게이트는 섞이지 않는다
    seedApproval(testDb.db, {
      stageId: stages.develop as string,
      approvalType: 'APV-GATE',
      level: 'high',
    });

    const row = repo.findLatestGateByStage(stageId);
    expect(row?.id).toBe(latest);
  });

  it('게이트 승인이 없으면 null', () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    expect(repo.findLatestGateByStage(stages.design as string)).toBeNull();
  });
});

describe('ApprovalRepository.resolve', () => {
  it('status·resolution·reason·resolvedAt을 갱신한다', () => {
    const id = seedApproval(testDb.db, { status: 'pending' });
    const now = isoNow();

    const updated = repo.resolve(id, {
      status: 'approved',
      resolution: 'A',
      reason: null,
      resolvedAt: now,
    });

    expect(updated.status).toBe('approved');
    expect(updated.resolution).toBe('A');
    expect(updated.resolved_at).toBe(now);
  });
});

describe('ApprovalRepository.countPendingByRequester / closePendingByRequester', () => {
  it('요청자의 pending 건수를 센다', () => {
    seedApproval(testDb.db, { requestedBy: 'agent-1', status: 'pending' });
    seedApproval(testDb.db, { requestedBy: 'agent-1', status: 'pending' });
    seedApproval(testDb.db, { requestedBy: 'agent-1', status: 'approved', resolvedAt: isoNow() });
    seedApproval(testDb.db, { requestedBy: 'agent-2', status: 'pending' });

    expect(repo.countPendingByRequester('agent-1')).toBe(2);
  });

  it('요청자의 pending 건 전체를 rejected(system:agent_deleted)로 마감하고 id 배열을 돌려준다', () => {
    const a = seedApproval(testDb.db, { requestedBy: 'agent-1', status: 'pending' });
    const b = seedApproval(testDb.db, { requestedBy: 'agent-1', status: 'pending' });
    const other = seedApproval(testDb.db, { requestedBy: 'agent-2', status: 'pending' });
    const now = isoNow();

    const closedIds = repo.closePendingByRequester('agent-1', {
      resolution: 'system:agent_deleted',
      reason: '요청 Agent 삭제로 자동 마감',
      resolvedAt: now,
    });

    expect(closedIds.sort()).toEqual([a, b].sort());
    expect(repo.findById(a)?.status).toBe('rejected');
    expect(repo.findById(a)?.resolution).toBe('system:agent_deleted');
    expect(repo.findById(b)?.status).toBe('rejected');
    // 다른 요청자 건은 건드리지 않는다
    expect(repo.findById(other)?.status).toBe('pending');
  });

  it('마감할 pending 건이 없으면 빈 배열을 돌려준다', () => {
    expect(
      repo.closePendingByRequester('없는-요청자', {
        resolution: 'system:agent_deleted',
        reason: '사유',
        resolvedAt: isoNow(),
      }),
    ).toEqual([]);
  });
});
