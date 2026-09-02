import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentRepository } from '../../../../src/backend/repositories/agent.repository.js';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import { ProjectRepository } from '../../../../src/backend/repositories/project.repository.js';
import { StatusChangeRepository } from '../../../../src/backend/repositories/status-change.repository.js';
import { TaskRepository } from '../../../../src/backend/repositories/task.repository.js';
import { AgentService } from '../../../../src/backend/services/agent.service.js';
import { ConversationService } from '../../../../src/backend/services/conversation.service.js';
import { createTestDb, seedProject, type TestDb } from '../../../fixtures/test-db.js';

/**
 * Agent 생성 원자성 — DES-004 v2.4 §7 "아래 3단계는 하나의 트랜잭션"
 *
 * 왜 테스트가 필요한가: `AgentService.create`는 better-sqlite3 트랜잭션 안에서
 * `ConversationService.createForAgent`를 **await 없이** 호출한다. 그 함수의
 * 본문이 전부 동기이기 때문에 안전한 것이며, **누군가 거기에 await를 넣는
 * 순간 채널이 트랜잭션 밖에서 만들어진다.**
 *
 * 아래 테스트가 그 전제를 지킨다 — 채널 생성이 실패하면 Agent도 남으면 안 된다.
 */

let testDb: TestDb;
let conversationService: ConversationService;
let service: AgentService;

beforeEach(() => {
  testDb = createTestDb();
  const conversationRepo = new ConversationRepository(testDb.db);
  conversationService = new ConversationService(conversationRepo, new MessageRepository(testDb.db));
  service = new AgentService(
    testDb.db,
    new AgentRepository(testDb.db),
    new StatusChangeRepository(testDb.db),
    new ProjectRepository(testDb.db),
    new TaskRepository(testDb.db),
    conversationService,
    conversationRepo,
  );
});

afterEach(() => {
  testDb.close();
});

const countAgents = () =>
  (testDb.db.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n;
const countChannels = () =>
  (
    testDb.db
      .prepare("SELECT COUNT(*) AS n FROM conversations WHERE channel_type='agent'")
      .get() as {
      n: number;
    }
  ).n;
const countHistory = () =>
  (
    testDb.db
      .prepare("SELECT COUNT(*) AS n FROM status_changes WHERE entity_type='agent'")
      .get() as {
      n: number;
    }
  ).n;

describe('Agent 생성 원자성', () => {
  it('정상 경로에서 Agent·채널·이력이 함께 만들어진다', async () => {
    const projectId = seedProject(testDb.db);
    await service.create({ projectId, name: '에이전트1' });

    expect(countAgents()).toBe(1);
    expect(countChannels()).toBe(1);
    expect(countHistory()).toBe(1);
  });

  it('채널 생성이 실패하면 Agent도 남지 않는다 (롤백)', async () => {
    const projectId = seedProject(testDb.db);

    // 트랜잭션 안에서 터지도록 만든다
    conversationService.createForAgent = () => {
      throw new Error('채널 생성 실패 시뮬레이션');
    };

    await expect(service.create({ projectId, name: '에이전트2' })).rejects.toThrow(
      '채널 생성 실패',
    );

    // 트랜잭션이 없으면 여기서 Agent가 1건 남는다 — 그게 이 테스트가 막는 것이다
    expect(countAgents()).toBe(0);
    expect(countChannels()).toBe(0);
    expect(countHistory()).toBe(0);
  });

  it('롤백 후에도 같은 이름으로 다시 만들 수 있다', async () => {
    const projectId = seedProject(testDb.db);
    const original = conversationService.createForAgent.bind(conversationService);

    conversationService.createForAgent = () => {
      throw new Error('일시 실패');
    };
    await expect(service.create({ projectId, name: '재시도' })).rejects.toThrow();

    // 롤백이 제대로 됐다면 UNIQUE(project_id, name)에 걸리지 않는다
    conversationService.createForAgent = original;
    const agent = await service.create({ projectId, name: '재시도' });

    expect(agent.name).toBe('재시도');
    expect(countAgents()).toBe(1);
    expect(countChannels()).toBe(1);
  });
});
