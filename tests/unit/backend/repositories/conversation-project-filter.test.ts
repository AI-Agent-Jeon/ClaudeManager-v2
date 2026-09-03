import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import {
  createTestDb,
  isoNow,
  seedAgent,
  seedAgentChannel,
  seedProject,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * `GET /api/conversations?project=` 필터와 삭제된 Agent
 *
 * D-27은 Agent가 삭제돼도 대화를 보존한다. 그런데 필터가 `agents` 조인에만
 * 의존하면 **Agent가 지워지는 순간 그 채널이 "이 프로젝트의 대화"에서 사라진다** —
 * 보존해 놓고 못 찾는 모순이다.
 *
 * `entity_snapshot.project_id`를 폴백으로 쓴다 (dev-sub Layer 2-3 보고 #4).
 */

let testDb: TestDb;
let repo: ConversationRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new ConversationRepository(testDb.db);
});

afterEach(() => {
  testDb.close();
});

/** Agent 삭제 = 스냅샷 기록 후 행 제거 (DES-004 §13 순서) */
function archiveAndDeleteAgent(agentId: string, convId: string, projectId: string): void {
  const snapshot = JSON.stringify({
    agent_name: '삭제된에이전트',
    project_name: '프로젝트',
    project_id: projectId,
    agent_type: 'dev',
  });
  repo.archiveWithSnapshot(convId, snapshot, isoNow());
  testDb.db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);
}

describe('project 필터 — 살아 있는 Agent', () => {
  it('해당 프로젝트의 채널만 반환한다', () => {
    const p1 = seedProject(testDb.db);
    const p2 = seedProject(testDb.db);
    seedAgentChannel(testDb.db, seedAgent(testDb.db, p1));
    seedAgentChannel(testDb.db, seedAgent(testDb.db, p2));

    const rows = repo.findMany({ projectId: p1, status: 'active' });
    expect(rows).toHaveLength(1);
  });
});

describe('project 필터 — 삭제된 Agent (D-27)', () => {
  it('아카이브 채널이 스냅샷의 project_id로 걸린다', () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const convId = seedAgentChannel(testDb.db, agentId);

    archiveAndDeleteAgent(agentId, convId, projectId);

    // 조인만 보면 여기서 0건이 된다 — 그게 이 테스트가 막는 것이다
    const rows = repo.findMany({ projectId, status: 'archived' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(convId);
  });

  it('다른 프로젝트의 아카이브 채널은 걸리지 않는다', () => {
    const p1 = seedProject(testDb.db);
    const p2 = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, p1);
    const convId = seedAgentChannel(testDb.db, agentId);

    archiveAndDeleteAgent(agentId, convId, p1);

    expect(repo.findMany({ projectId: p2, status: 'archived' })).toHaveLength(0);
  });

  it('project_id가 없는 옛 스냅샷은 걸리지 않되 조회 자체는 깨지지 않는다', () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const convId = seedAgentChannel(testDb.db, agentId);

    // 마이그레이션 이전 형식 — project_id가 없다
    repo.archiveWithSnapshot(
      convId,
      JSON.stringify({ agent_name: 'x', project_name: 'y', agent_type: 'z' }),
      isoNow(),
    );
    testDb.db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);

    expect(() => repo.findMany({ projectId, status: 'archived' })).not.toThrow();
    expect(repo.findMany({ projectId, status: 'archived' })).toHaveLength(0);
    // 필터 없이는 여전히 조회된다 — 대화는 보존되어 있다
    expect(repo.findMany({ status: 'archived' })).toHaveLength(1);
  });
});
