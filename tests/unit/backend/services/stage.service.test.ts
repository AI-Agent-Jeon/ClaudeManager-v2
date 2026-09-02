import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../../../src/backend/repositories/agent.repository.js';
import { ApprovalRepository } from '../../../../src/backend/repositories/approval.repository.js';
import { ArtifactRepository } from '../../../../src/backend/repositories/artifact.repository.js';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import { PhaseRepository } from '../../../../src/backend/repositories/phase.repository.js';
import { ProjectRepository } from '../../../../src/backend/repositories/project.repository.js';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { TaskRepository } from '../../../../src/backend/repositories/task.repository.js';
import { AgentService } from '../../../../src/backend/services/agent.service.js';
import { ApprovalService } from '../../../../src/backend/services/approval.service.js';
import { ConversationService } from '../../../../src/backend/services/conversation.service.js';
import { PhaseService } from '../../../../src/backend/services/phase.service.js';
import { StageService } from '../../../../src/backend/services/stage.service.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import { WebSocketHub } from '../../../../src/backend/ws/hub.js';
import {
  createTestDb,
  isoNow,
  seedApproval,
  seedPhase,
  seedStages,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * StageService (FR-030 승인 게이트 강제)
 *
 * 정의 원본: DES-004 v2.4 §16 · §전체 함수 시그니처 요약(StageService) ·
 * DES-002 v2.1 §5 `POST /api/stages/:id/start` · DES-007 v2.1 §7 · §7-1 · §7-2
 *
 * `POST /api/stages/:id/start`가 FR-030 게이트의 유일한 강제 지점이다(개발 지시).
 * 3단 가드를 각각 독립적으로 검증한다 — 어느 가드가 걸렸는지 에러 코드로 구분되어야 한다.
 */

let testDb: TestDb;
let service: StageService;
let phaseRepo: PhaseRepository;
let phaseService: PhaseService;

beforeEach(() => {
  testDb = createTestDb();
  phaseRepo = new PhaseRepository(testDb.db);
  phaseService = new PhaseService(testDb.db, phaseRepo);

  const agentRepo = new AgentRepository(testDb.db);
  const conversationRepo = new ConversationRepository(testDb.db);
  const messageRepo = new MessageRepository(testDb.db);
  const statusChangeRepo = new StatusChangeRepository(testDb.db);
  const conversationService = new ConversationService(conversationRepo, messageRepo);
  const agentService = new AgentService(
    testDb.db,
    agentRepo,
    statusChangeRepo,
    new ProjectRepository(testDb.db),
    new TaskRepository(testDb.db),
    conversationService,
    conversationRepo,
  );
  const approvalService = new ApprovalService(
    testDb.db,
    new ApprovalRepository(testDb.db),
    statusChangeRepo,
    messageRepo,
    conversationRepo,
    agentRepo,
    new ArtifactRepository(testDb.db),
    agentService,
    new WebSocketHub(),
  );

  service = new StageService(
    testDb.db,
    phaseRepo,
    approvalService,
    statusChangeRepo,
    new WebSocketHub(),
  );
});

afterEach(() => {
  testDb.close();
});

function setStageStatus(
  stageId: string,
  status: string,
  overrides: { startedAt?: string; completedAt?: string } = {},
): void {
  testDb.db
    .prepare('UPDATE stages SET status = ?, started_at = ?, completed_at = ? WHERE id = ?')
    .run(status, overrides.startedAt ?? null, overrides.completedAt ?? null, stageId);
}

function insertWaiver(phaseId: string, rule: string): void {
  testDb.db
    .prepare('INSERT INTO wip_waivers (id, phase_id, rule, reason, created_at) VALUES (?,?,?,?,?)')
    .run(crypto.randomUUID(), phaseId, rule, '병행 사유', isoNow());
}

/**
 * APV-GATE 승인 1건을 심는다. DB CHECK(DES-003 §4-1 (5))
 * `status = 'pending' OR resolved_at IS NOT NULL`을 만족시키려면 처리된
 * 상태(`approved`·`rejected`)는 `resolvedAt`을 반드시 채워야 한다.
 */
function seedGateApproval(
  stageId: string,
  status: 'pending' | 'approved' | 'rejected',
  reason: string | null = null,
): string {
  return seedApproval(testDb.db, {
    stageId,
    approvalType: 'APV-GATE',
    level: 'high',
    status,
    reason,
    resolvedAt: status === 'pending' ? null : isoNow(),
  });
}

/** plan 단계를 completed로 만들어, analyze 착수 시 가드 1(직전 단계 완료)을 통과시킨다 */
function completePlan(stages: Record<string, string>): void {
  setStageStatus(stages.plan as string, 'completed', { completedAt: isoNow() });
}

describe('StageService.start — 가드 1: 직전 단계 완료', () => {
  it('존재하지 않는 단계 id면 404 STAGE_NOT_FOUND', async () => {
    await expect(service.start(crypto.randomUUID())).rejects.toThrow(AppError);
    try {
      await service.start(crypto.randomUUID());
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('STAGE_NOT_FOUND');
    }
  });

  it('첫 번째 단계(plan)는 직전 단계가 없어 가드 1을 통과한다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);

    // plan은 게이트 필요 단계이므로 가드 1만 독립적으로 보려면 APV-GATE를 미리 승인해 둔다
    seedGateApproval(stages.plan as string, 'approved');

    const summary = await service.start(stages.plan as string);
    expect(summary.status).toBe('in_progress');
  });

  it('직전 단계(plan)가 completed가 아니면 422 INVALID_TRANSITION (가드 2·3보다 먼저 걸린다)', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    // plan을 pending으로 둔 채 analyze 착수 시도 — 게이트 미승인·WIP 문제가 없어도 가드 1에서 막힌다

    await expect(service.start(stages.analyze as string)).rejects.toThrow(AppError);
    try {
      await service.start(stages.analyze as string);
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('이미 in_progress인 단계를 다시 착수하면 422 INVALID_TRANSITION (STAGE_TRANSITIONS 기반)', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'in_progress', { startedAt: isoNow() });

    await expect(service.start(stages.plan as string)).rejects.toThrow(AppError);
    try {
      await service.start(stages.plan as string);
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('이미 completed인 단계를 다시 착수하면 422 INVALID_TRANSITION', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'completed', { completedAt: isoNow() });

    await expect(service.start(stages.plan as string)).rejects.toThrow(AppError);
    try {
      await service.start(stages.plan as string);
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
    }
  });
});

describe('StageService.start — 가드 2: 승인 게이트', () => {
  it('게이트 필요 단계(plan)인데 APV-GATE가 없으면 403 GATE_NOT_PASSED', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);

    await expect(service.start(stages.plan as string)).rejects.toThrow(AppError);
    try {
      await service.start(stages.plan as string);
    } catch (e) {
      expect((e as AppError).statusCode).toBe(403);
      expect((e as AppError).code).toBe('GATE_NOT_PASSED');
    }
  });

  it('APV-GATE가 pending이면 403 GATE_NOT_PASSED', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    seedGateApproval(stages.plan as string, 'pending');

    await expect(service.start(stages.plan as string)).rejects.toThrow(AppError);
    try {
      await service.start(stages.plan as string);
    } catch (e) {
      expect((e as AppError).code).toBe('GATE_NOT_PASSED');
    }
  });

  it('APV-GATE가 rejected이면 403 GATE_NOT_PASSED (착수 재시도로 우회 불가 — FR-030 회귀 방어선)', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    seedGateApproval(stages.plan as string, 'rejected', '보완 필요');

    await expect(service.start(stages.plan as string)).rejects.toThrow(AppError);
    try {
      await service.start(stages.plan as string);
    } catch (e) {
      expect((e as AppError).code).toBe('GATE_NOT_PASSED');
    }
  });

  it('APV-GATE가 approved이면 착수에 성공한다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    seedGateApproval(stages.plan as string, 'approved');

    const summary = await service.start(stages.plan as string);
    expect(summary.status).toBe('in_progress');
    expect(summary.gate.passed).toBe(true);
  });

  it('게이트 불필요 단계(analyze)는 승인 없이 착수할 수 있다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    completePlan(stages);

    const summary = await service.start(stages.analyze as string);
    expect(summary.status).toBe('in_progress');
    expect(summary.gate.required).toBe(false);
  });
});

describe('StageService.start — 가드 3: WIP=1', () => {
  /**
   * design의 직전 단계는 analyze다(guard 1). WIP 위반은 design과 무관한 다른
   * 단계(plan)가 이미 in_progress인 상황으로 만든다 — 그래야 가드 1이 먼저
   * 걸리지 않고 가드 3만 독립적으로 검증된다.
   */
  function makeDesignWipViolationSetup(stages: Record<string, string>): void {
    setStageStatus(stages.plan as string, 'in_progress', { startedAt: isoNow() });
    setStageStatus(stages.analyze as string, 'completed', { completedAt: isoNow() });
  }

  it('이미 다른 단계가 in_progress이고 면제가 없으면 409 WIP_VIOLATION', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    makeDesignWipViolationSetup(stages);

    await expect(service.start(stages.design as string)).rejects.toThrow(AppError);
    try {
      await service.start(stages.design as string);
    } catch (e) {
      expect((e as AppError).statusCode).toBe(409);
      expect((e as AppError).code).toBe('WIP_VIOLATION');
    }
  });

  it('WIP 면제가 등록되어 있으면 착수에 성공한다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    makeDesignWipViolationSetup(stages);
    insertWaiver(phaseId, '주요 단계 WIP = 1');

    const summary = await service.start(stages.design as string);
    expect(summary.status).toBe('in_progress');
  });
});

describe('StageService.start — 착수 성공 시 부수 효과', () => {
  it('stages.status가 in_progress로, started_at이 기록되고 phases.current_stage가 갱신된다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    seedGateApproval(stages.plan as string, 'approved');

    await service.start(stages.plan as string);

    const row = testDb.db.prepare('SELECT * FROM stages WHERE id = ?').get(stages.plan) as {
      status: string;
      started_at: string | null;
    };
    expect(row.status).toBe('in_progress');
    expect(row.started_at).not.toBeNull();

    const phase = testDb.db
      .prepare('SELECT current_stage FROM phases WHERE id = ?')
      .get(phaseId) as {
      current_stage: string;
    };
    expect(phase.current_stage).toBe('plan');
  });

  it('status_changes에 stage 전이가 기록된다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    seedGateApproval(stages.plan as string, 'approved');

    await service.start(stages.plan as string);

    const changes = testDb.db
      .prepare("SELECT * FROM status_changes WHERE entity_type = 'stage' AND entity_id = ?")
      .all(stages.plan) as { from_status: string | null; to_status: string }[];
    expect(changes.length).toBe(1);
    expect(changes[0]?.from_status).toBe('pending');
    expect(changes[0]?.to_status).toBe('in_progress');
  });
});

describe('StageService.complete', () => {
  it('in_progress 단계를 completed로 전이한다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'in_progress', { startedAt: isoNow() });

    const summary = await service.complete(stages.plan as string);
    expect(summary.status).toBe('completed');
    expect(summary.completedAt).not.toBeNull();
  });

  it('completed → in_progress 역전이는 존재하지 않는다 (R-03) — pending 단계를 완료하려 하면 422', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    // pending 상태에서 바로 complete 시도 — STAGE_TRANSITIONS에 pending→completed가 없다

    await expect(service.complete(stages.plan as string)).rejects.toThrow(AppError);
    try {
      await service.complete(stages.plan as string);
    } catch (e) {
      expect((e as AppError).statusCode).toBe(422);
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('이미 completed인 단계를 다시 completed로 전이하려 하면 422 (역전이 없음의 회귀 방어)', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'completed', { completedAt: isoNow() });

    await expect(service.complete(stages.plan as string)).rejects.toThrow(AppError);
    try {
      await service.complete(stages.plan as string);
    } catch (e) {
      expect((e as AppError).code).toBe('INVALID_TRANSITION');
    }
  });

  it('존재하지 않는 단계 id면 404 STAGE_NOT_FOUND', async () => {
    await expect(service.complete(crypto.randomUUID())).rejects.toThrow(AppError);
  });

  it('완료 시 status_changes에 기록된다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    setStageStatus(stages.plan as string, 'in_progress', { startedAt: isoNow() });

    await service.complete(stages.plan as string);

    const changes = testDb.db
      .prepare("SELECT * FROM status_changes WHERE entity_type = 'stage' AND entity_id = ?")
      .all(stages.plan) as { from_status: string | null; to_status: string }[];
    expect(changes.length).toBe(1);
    expect(changes[0]?.to_status).toBe('completed');
  });
});

describe('StageService.isGateRequired — PhaseService와 매핑 일치 (개발 지시 §2, 실패 조건)', () => {
  it('7개 스킬 전건에서 StageService·PhaseService의 gate.required 판정이 같다', async () => {
    const current = await phaseService.create({ number: 42, name: '매핑 일치 확인용' });

    for (const stage of current.stages) {
      expect(service.isGateRequired(stage.skill)).toBe(stage.gate.required);
    }
  });

  it('plan·test만 true, 나머지 5개는 false다', () => {
    const skills = ['plan', 'analyze', 'design', 'develop', 'test', 'deploy', 'operate'] as const;
    const required = skills.filter((s) => service.isGateRequired(s));
    expect(required.sort()).toEqual(['plan', 'test']);
  });
});
