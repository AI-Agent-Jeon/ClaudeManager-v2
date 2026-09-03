import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import {
  createTestDb,
  isoNow,
  seedMainChannel,
  seedMessage,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * MessageRepository — FR-027 (메시지 CRUD + FTS5 전문 검색)
 *
 * 정의 원본: DES-003 v2.1 §3-2 · §3-3 (migrations/002_conversations.sql)
 */

let testDb: TestDb;
let repo: MessageRepository;
let convId: string;

beforeEach(() => {
  testDb = createTestDb();
  repo = new MessageRepository(testDb.db);
  convId = seedMainChannel(testDb.db);
});

afterEach(() => {
  testDb.close();
});

describe('insert · findById', () => {
  it('메시지를 삽입하고 조회할 수 있다', () => {
    const row = repo.insert({
      id: crypto.randomUUID(),
      conversationId: convId,
      msgType: 'MSG-01',
      senderRole: 'ceo',
      body: '안녕하세요',
      structured: null,
      createdAt: isoNow(),
    });

    expect(row.body).toBe('안녕하세요');
    expect(row.approval_id).toBeNull();
  });

  it('MSG-04 메시지에 approvals.message_id가 연결되면 approval_id가 채워진다', () => {
    const msg = repo.insert({
      id: crypto.randomUUID(),
      conversationId: convId,
      msgType: 'MSG-04',
      senderRole: 'agent',
      body: '승인 요청',
      structured: null,
      createdAt: isoNow(),
    });

    const approvalId = crypto.randomUUID();
    testDb.db
      .prepare(
        `INSERT INTO approvals (id, message_id, approval_type, level, subject, requested_by, status, created_at, resolved_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(approvalId, msg.id, 'APV-GATE', 'high', '제목', 'main', 'pending', isoNow(), null);

    const found = repo.findById(msg.id);
    expect(found?.approval_id).toBe(approvalId);
  });
});

describe('findLatest', () => {
  it('가장 최근 메시지 1건을 반환한다', () => {
    seedMessage(testDb.db, convId, { createdAt: '2024-01-01T00:00:00.000Z', body: '옛날' });
    const latestId = seedMessage(testDb.db, convId, {
      createdAt: '2024-06-01T00:00:00.000Z',
      body: '최근',
    });

    expect(repo.findLatest(convId)?.id).toBe(latestId);
  });

  it('메시지가 없으면 null을 반환한다', () => {
    expect(repo.findLatest(convId)).toBeNull();
  });
});

describe('listByCursor', () => {
  function seedTimeline(count: number): string[] {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const createdAt = new Date(2024, 0, 1, 0, 0, i).toISOString();
      ids.push(seedMessage(testDb.db, convId, { createdAt, body: `메시지-${i}` }));
    }
    return ids;
  }

  it('cursor 없이 조회하면 최신순(DESC)으로 반환한다', () => {
    const ids = seedTimeline(5);
    const rows = repo.listByCursor(convId, null, 'before', 3);
    expect(rows.map((r) => r.id)).toEqual([ids[4], ids[3], ids[2]]);
  });

  it('direction=before는 커서보다 오래된 메시지를 반환한다 — 페이지를 이어 붙여도 중복·누락이 없다', () => {
    const ids = seedTimeline(5);

    const page1 = repo.listByCursor(convId, null, 'before', 2);
    expect(page1.map((r) => r.id)).toEqual([ids[4], ids[3]]);

    const cursor = { createdAt: page1[1]?.created_at as string, id: page1[1]?.id as string };
    const page2 = repo.listByCursor(convId, cursor, 'before', 2);
    expect(page2.map((r) => r.id)).toEqual([ids[2], ids[1]]);

    const cursor2 = { createdAt: page2[1]?.created_at as string, id: page2[1]?.id as string };
    const page3 = repo.listByCursor(convId, cursor2, 'before', 2);
    expect(page3.map((r) => r.id)).toEqual([ids[0]]);

    // 전건 이어붙이면 원본과 정확히 일치한다 — 중복·누락 없음
    const combined = [...page1, ...page2, ...page3].map((r) => r.id);
    expect(combined).toEqual([...ids].reverse());
  });

  it('direction=after는 커서보다 최신인 메시지를 반환한다', () => {
    const ids = seedTimeline(5);
    const middle = repo.listByCursor(convId, null, 'before', 5)[2] as {
      created_at: string;
      id: string;
    };

    const rows = repo.listByCursor(
      convId,
      { createdAt: middle.created_at, id: middle.id },
      'after',
      10,
    );
    expect(rows.map((r) => r.id)).toEqual([ids[3], ids[4]]);
  });
});

describe('listAll', () => {
  it('시간순(오래된 것부터)으로 채널 전체를 반환한다', () => {
    const first = seedMessage(testDb.db, convId, { createdAt: '2024-01-01T00:00:00.000Z' });
    const second = seedMessage(testDb.db, convId, { createdAt: '2024-02-01T00:00:00.000Z' });

    const rows = repo.listAll(convId);
    expect(rows.map((r) => r.id)).toEqual([first, second]);
  });
});

describe('search — FTS5 전문 검색', () => {
  it('본문에 검색어가 포함된 메시지를 snippet과 함께 반환한다', () => {
    seedMessage(testDb.db, convId, { body: 'DES-003 설계 개정을 완료했습니다' });
    seedMessage(testDb.db, convId, { body: '전혀 관련 없는 내용' });

    const rows = repo.search({ q: '설계', limit: 20 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.snippet).toContain('<mark>');
  });

  it('type·status 필터를 적용한다', () => {
    seedMessage(testDb.db, convId, { body: '검색어포함' });

    const rows = repo.search({ q: '검색어포함', type: 'agent', limit: 20 });
    expect(rows).toHaveLength(0);

    const mainRows = repo.search({ q: '검색어포함', type: 'main', limit: 20 });
    expect(mainRows).toHaveLength(1);
  });

  it('limit을 적용한다', () => {
    for (let i = 0; i < 5; i++) {
      seedMessage(testDb.db, convId, { body: `공통검색어-${i}` });
    }
    const rows = repo.search({ q: '공통검색어', limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
