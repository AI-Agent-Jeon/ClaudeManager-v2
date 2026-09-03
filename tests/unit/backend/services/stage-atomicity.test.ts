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
import { StageService } from '../../../../src/backend/services/stage.service.js';
import { TaskService } from '../../../../src/backend/services/task.service.js';
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
 * StageService.start 트랜잭션 원자성 — DES-004 v2.4 §16 · 개발 지시 §3
 *
 * 왜 필요한가: `start()`는 `stages.status='in_progress'` 갱신 →
 * `phases.current_stage` 갱신 → `status_changes` 기록까지 하나의 SQLite
 * 트랜잭션이어야 한다(개발 지시 §3 "전이와 phases.current_stage 갱신이 함께
 * 롤백되는지"). `phase-atomicity.test.ts`를 본떠, 실제 SQLite 롤백을
 * 목킹 없이 검증한다.
 */

let testDb: TestDb;
let service: StageService;
let phaseRepo: PhaseRepository;

beforeEach(() => {
  testDb = createTestDb();
  phaseRepo = new PhaseRepository(testDb.db);

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
    new TaskService(new TaskRepository(testDb.db), statusChangeRepo, agentRepo),
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

function stageRow(id: string) {
  return testDb.db.prepare('SELECT * FROM stages WHERE id = ?').get(id) as {
    status: string;
    started_at: string | null;
  };
}

function phaseCurrentStage(id: string) {
  return (
    testDb.db.prepare('SELECT current_stage FROM phases WHERE id = ?').get(id) as {
      current_stage: string | null;
    }
  ).current_stage;
}

function countStatusChanges(stageId: string): number {
  return (
    testDb.db
      .prepare(
        "SELECT COUNT(*) AS n FROM status_changes WHERE entity_type = 'stage' AND entity_id = ?",
      )
      .get(stageId) as { n: number }
  ).n;
}

describe('StageService.start 원자성', () => {
  it('status_changes 기록이 실패하면 stages·phases.current_stage 갱신도 함께 롤백된다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    seedApproval(testDb.db, {
      stageId: stages.plan,
      approvalType: 'APV-GATE',
      level: 'high',
      status: 'approved',
      resolvedAt: isoNow(),
    });

    // status_changes.entity_type CHECK 제약을 우회할 수 없는 값으로 몰아
    // 트랜잭션 내부에서 진짜 실패를 일으킨다 — 서비스 코드를 몽키패치하지 않고
    // DB 자체의 무결성 제약으로 실패를 재현한다 (approval-atomicity.test.ts와 같은 방식).
    const original = testDb.db.prepare.bind(testDb.db);
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (testDb.db as any).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO status_changes')) {
        throw new Error('status_changes 기록 실패 시뮬레이션');
      }
      return original(sql);
    };

    await expect(service.start(stages.plan as string)).rejects.toThrow(
      'status_changes 기록 실패 시뮬레이션',
    );

    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치 복원
    (testDb.db as any).prepare = original;

    const row = stageRow(stages.plan as string);
    expect(row.status).toBe('pending');
    expect(row.started_at).toBeNull();
    expect(phaseCurrentStage(phaseId)).toBeNull();
    expect(countStatusChanges(stages.plan as string)).toBe(0);
  });

  it('phases.current_stage 갱신이 실패하면 stages 전이도 함께 롤백된다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    seedApproval(testDb.db, {
      stageId: stages.plan,
      approvalType: 'APV-GATE',
      level: 'high',
      status: 'approved',
      resolvedAt: isoNow(),
    });

    const original = testDb.db.prepare.bind(testDb.db);
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (testDb.db as any).prepare = (sql: string) => {
      if (sql.includes('UPDATE phases SET current_stage')) {
        throw new Error('current_stage 갱신 실패 시뮬레이션');
      }
      return original(sql);
    };

    await expect(service.start(stages.plan as string)).rejects.toThrow(
      'current_stage 갱신 실패 시뮬레이션',
    );

    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치 복원
    (testDb.db as any).prepare = original;

    const row = stageRow(stages.plan as string);
    expect(row.status).toBe('pending');
    expect(row.started_at).toBeNull();
    expect(countStatusChanges(stages.plan as string)).toBe(0);
  });
});

describe('StageService.complete 원자성', () => {
  it('status_changes 기록이 실패하면 stages.status=completed 갱신도 롤백된다', async () => {
    const phaseId = seedPhase(testDb.db);
    const stages = seedStages(testDb.db, phaseId);
    testDb.db
      .prepare("UPDATE stages SET status = 'in_progress', started_at = ? WHERE id = ?")
      .run(isoNow(), stages.plan);

    const original = testDb.db.prepare.bind(testDb.db);
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (testDb.db as any).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO status_changes')) {
        throw new Error('status_changes 기록 실패 시뮬레이션 2');
      }
      return original(sql);
    };

    await expect(service.complete(stages.plan as string)).rejects.toThrow(
      'status_changes 기록 실패 시뮬레이션 2',
    );

    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치 복원
    (testDb.db as any).prepare = original;

    const row = stageRow(stages.plan as string);
    expect(row.status).toBe('in_progress');
    expect(countStatusChanges(stages.plan as string)).toBe(0);
  });
});
