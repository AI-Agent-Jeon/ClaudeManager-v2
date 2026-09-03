import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../../../src/backend/repositories/agent.repository.js';
import { ApprovalRepository } from '../../../../src/backend/repositories/approval.repository.js';
import { ArtifactRepository } from '../../../../src/backend/repositories/artifact.repository.js';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import { ProjectRepository } from '../../../../src/backend/repositories/project.repository.js';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { TaskRepository } from '../../../../src/backend/repositories/task.repository.js';
import { AgentService } from '../../../../src/backend/services/agent.service.js';
import { ApprovalService } from '../../../../src/backend/services/approval.service.js';
import { ConversationService } from '../../../../src/backend/services/conversation.service.js';
import { TaskService } from '../../../../src/backend/services/task.service.js';
import { WebSocketHub } from '../../../../src/backend/ws/hub.js';
import {
  createTestDb,
  seedApproval,
  seedMainChannel,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * ApprovalService 트랜잭션 원자성 — DES-004 v2.4 §15
 *
 * 왜 필요한가: `request()`는 MSG-04 기록 → approvals INSERT →
 * status_changes 기록까지 하나의 SQLite 트랜잭션이어야 한다. `resolve()`도
 * approvals 갱신 → status_changes 기록 → MSG-01 기록이 하나의 트랜잭션이다.
 * `agent-atomicity.test.ts`(Layer 2-4)를 본떠, 트랜잭션 도중 실패하면 그
 * 이전 단계의 쓰기도 함께 롤백되는지 검증한다.
 */

let testDb: TestDb;
let service: ApprovalService;
let approvalRepo: ApprovalRepository;
let messageRepo: MessageRepository;

beforeEach(() => {
  testDb = createTestDb();
  approvalRepo = new ApprovalRepository(testDb.db);
  messageRepo = new MessageRepository(testDb.db);
  const conversationRepo = new ConversationRepository(testDb.db);
  const agentRepo = new AgentRepository(testDb.db);
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

  service = new ApprovalService(
    testDb.db,
    approvalRepo,
    statusChangeRepo,
    messageRepo,
    conversationRepo,
    agentRepo,
    new ArtifactRepository(testDb.db),
    agentService,
    new WebSocketHub(),
  );
});

afterEach(() => {
  testDb.close();
});

const countMessages = () =>
  (testDb.db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number }).n;
const countApprovals = () =>
  (testDb.db.prepare('SELECT COUNT(*) AS n FROM approvals').get() as { n: number }).n;
const countStatusChanges = () =>
  (
    testDb.db
      .prepare("SELECT COUNT(*) AS n FROM status_changes WHERE entity_type='approval'")
      .get() as {
      n: number;
    }
  ).n;

describe('ApprovalService.request 원자성', () => {
  it('approvals INSERT가 실패하면(존재하지 않는 stageId → FK 위반) MSG-04도 함께 롤백된다', async () => {
    const conversationId = seedMainChannel(testDb.db);

    await expect(
      service.request({
        approvalType: 'APV-CHOICE',
        level: 'high',
        subject: '롤백 대상',
        options: [{ code: 'A', label: '승인' }],
        requestedBy: 'main',
        conversationId,
        stageId: crypto.randomUUID(), // 존재하지 않는 단계 — approvalRepo.insert가 FK 위반으로 던진다
      }),
    ).rejects.toThrow();

    expect(countMessages()).toBe(0);
    expect(countApprovals()).toBe(0);
    expect(countStatusChanges()).toBe(0);
  });

  it('status_changes 기록이 실패하면 MSG-04·approvals도 함께 롤백된다', async () => {
    const conversationId = seedMainChannel(testDb.db);

    // status_changes.entity_type CHECK 제약을 우회할 수 없는 값으로 몰아
    // 트랜잭션 내부에서 진짜 실패를 일으킨다 — 서비스 코드를 몽키패치하지 않고
    // DB 자체의 무결성 제약으로 실패를 재현한다.
    const original = testDb.db.prepare.bind(testDb.db);
    let calls = 0;
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (testDb.db as any).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO status_changes')) {
        calls += 1;
        throw new Error('status_changes 기록 실패 시뮬레이션');
      }
      return original(sql);
    };

    await expect(
      service.request({
        approvalType: 'APV-CHOICE',
        level: 'high',
        subject: '롤백 대상 2',
        options: [{ code: 'A', label: '승인' }],
        requestedBy: 'main',
        conversationId,
      }),
    ).rejects.toThrow('status_changes 기록 실패 시뮬레이션');

    expect(calls).toBeGreaterThan(0);
    expect(countMessages()).toBe(0);
    expect(countApprovals()).toBe(0);
  });
});

describe('ApprovalService.resolve 원자성', () => {
  it('MSG-01 기록이 실패하면 approvals 갱신·status_changes 기록도 함께 롤백된다', async () => {
    const conversationId = seedMainChannel(testDb.db);
    const messageId = messageRepo.insert({
      id: crypto.randomUUID(),
      conversationId,
      msgType: 'MSG-04',
      senderRole: 'agent',
      body: '원본 요청',
      structured: null,
      createdAt: new Date().toISOString(),
    }).id;
    const approvalId = seedApproval(testDb.db, {
      messageId,
      status: 'pending',
      options: JSON.stringify([{ code: 'A', label: '승인' }]),
    });

    const original = testDb.db.prepare.bind(testDb.db);
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치
    (testDb.db as any).prepare = (sql: string) => {
      if (sql.includes('INSERT INTO messages')) {
        throw new Error('MSG-01 기록 실패 시뮬레이션');
      }
      return original(sql);
    };

    await expect(
      service.resolve(approvalId, { status: 'approved', resolution: 'A' }),
    ).rejects.toThrow('MSG-01 기록 실패 시뮬레이션');

    // 롤백되었다면 approvals는 여전히 pending이어야 한다
    // biome-ignore lint/suspicious/noExplicitAny: 테스트 전용 몽키패치 복원
    (testDb.db as any).prepare = original;
    expect(approvalRepo.findById(approvalId)?.status).toBe('pending');
    expect(countStatusChanges()).toBe(0);
  });
});
