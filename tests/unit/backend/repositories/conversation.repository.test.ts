import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import {
  createTestDb,
  isoNow,
  seedAgent,
  seedAgentChannel,
  seedMainChannel,
  seedProject,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * ConversationRepository — FR-026
 *
 * 정의 원본: DES-003 v2.1 §3-1 (migrations/002_conversations.sql)
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

describe('insert · findById', () => {
  it('main 채널을 삽입하고 조회할 수 있다', () => {
    const id = crypto.randomUUID();
    repo.insert({ id, channelType: 'main', entityId: null, status: 'active', createdAt: isoNow() });

    const row = repo.findById(id);
    expect(row?.channel_type).toBe('main');
    expect(row?.entity_id).toBeNull();
  });

  it('존재하지 않는 id는 null을 반환한다', () => {
    expect(repo.findById(crypto.randomUUID())).toBeNull();
  });
});

describe('findByEntityId', () => {
  it('agent 채널을 entityId로 찾는다', () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const convId = seedAgentChannel(testDb.db, agentId);

    const row = repo.findByEntityId(agentId);
    expect(row?.id).toBe(convId);
    expect(row?.channel_type).toBe('agent');
  });

  it('채널이 없으면 null을 반환한다', () => {
    expect(repo.findByEntityId(crypto.randomUUID())).toBeNull();
  });
});

describe('findMainChannel', () => {
  it('CH-MAIN 1건을 반환한다', () => {
    const id = seedMainChannel(testDb.db);
    const row = repo.findMainChannel();
    expect(row?.id).toBe(id);
  });

  it('CH-MAIN이 없으면 null을 반환한다', () => {
    expect(repo.findMainChannel()).toBeNull();
  });
});

describe('findByIdWithAgent — title 파생용 조인', () => {
  it('agent 채널은 agents.name을 조인해 agent_name을 채운다', () => {
    const projectId = seedProject(testDb.db, { name: '조인프로젝트' });
    const agentId = seedAgent(testDb.db, projectId, { name: '조인에이전트' });
    const convId = seedAgentChannel(testDb.db, agentId);

    const row = repo.findByIdWithAgent(convId);
    expect(row?.agent_name).toBe('조인에이전트');
    expect(row?.project_id).toBe(projectId);
  });

  it('main 채널은 agent_name이 null이다', () => {
    const id = seedMainChannel(testDb.db);
    const row = repo.findByIdWithAgent(id);
    expect(row?.agent_name).toBeNull();
  });

  it('Agent가 삭제된 아카이브 채널은 agent_name이 null이다 (D-27 — entity_snapshot으로 title을 대신 만든다)', () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId, { name: '삭제될에이전트' });
    const convId = seedAgentChannel(testDb.db, agentId);

    repo.archiveWithSnapshot(
      convId,
      JSON.stringify({ agent_name: '삭제될에이전트', project_name: 'p', agent_type: 't' }),
      isoNow(),
    );
    testDb.db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);

    const row = repo.findByIdWithAgent(convId);
    expect(row?.agent_name).toBeNull();
    expect(row?.entity_snapshot).toContain('삭제될에이전트');
  });
});

describe('findMany', () => {
  it('type 필터로 main/agent를 구분한다', () => {
    seedMainChannel(testDb.db);
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    seedAgentChannel(testDb.db, agentId);

    const mains = repo.findMany({ type: 'main' });
    expect(mains).toHaveLength(1);
    expect(mains[0]?.channel_type).toBe('main');

    const agents = repo.findMany({ type: 'agent' });
    expect(agents).toHaveLength(1);
    expect(agents[0]?.channel_type).toBe('agent');
  });

  it('status 필터를 적용한다 (기본은 Service가 active를 넣어준다)', () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const convId = seedAgentChannel(testDb.db, agentId);
    repo.updateStatus(convId, 'readonly');

    expect(repo.findMany({ status: 'active' })).toHaveLength(0);
    expect(repo.findMany({ status: 'readonly' })).toHaveLength(1);
  });

  it('projectId 필터는 agents 조인에 의존한다', () => {
    const projectA = seedProject(testDb.db, { name: 'A' });
    const projectB = seedProject(testDb.db, { name: 'B' });
    const agentA = seedAgent(testDb.db, projectA);
    const agentB = seedAgent(testDb.db, projectB);
    seedAgentChannel(testDb.db, agentA);
    seedAgentChannel(testDb.db, agentB);

    const rows = repo.findMany({ projectId: projectA });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity_id).toBe(agentA);
  });

  it('from/to로 생성 기간을 필터링한다', () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const oldId = seedAgentChannel(testDb.db, agentId);
    testDb.db
      .prepare('UPDATE conversations SET created_at = ? WHERE id = ?')
      .run('2000-01-01T00:00:00.000Z', oldId);

    const recent = repo.findMany({ from: '2020-01-01T00:00:00.000Z' });
    expect(recent.find((r) => r.id === oldId)).toBeUndefined();
  });

  it('정렬은 created_at DESC다', () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const first = seedAgentChannel(testDb.db, agentId);
    testDb.db
      .prepare('UPDATE conversations SET created_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', first);
    const second = seedAgentChannel(testDb.db, agentId);
    testDb.db
      .prepare('UPDATE conversations SET created_at = ? WHERE id = ?')
      .run('2021-01-01T00:00:00.000Z', second);

    const rows = repo.findMany({});
    expect(rows[0]?.id).toBe(second);
    expect(rows[1]?.id).toBe(first);
  });
});

describe('updateStatus · archiveWithSnapshot', () => {
  it('updateStatus는 상태만 바꾼다', () => {
    const id = seedMainChannel(testDb.db);
    const updated = repo.updateStatus(id, 'readonly');
    expect(updated.status).toBe('readonly');
  });

  it('archiveWithSnapshot은 status archived + entity_snapshot + archived_at을 채운다', () => {
    const projectId = seedProject(testDb.db);
    const agentId = seedAgent(testDb.db, projectId);
    const convId = seedAgentChannel(testDb.db, agentId);

    const now = isoNow();
    const snapshot = JSON.stringify({ agent_name: 'x', project_name: 'y', agent_type: 'z' });
    const updated = repo.archiveWithSnapshot(convId, snapshot, now);

    expect(updated.status).toBe('archived');
    expect(updated.entity_snapshot).toBe(snapshot);
    expect(updated.archived_at).toBe(now);
  });
});
