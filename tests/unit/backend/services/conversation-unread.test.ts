import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import { ConversationService } from '../../../../src/backend/services/conversation.service.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import {
  createTestDb,
  isoNow,
  seedMainChannel,
  seedMessage,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * 미읽음 수 — DEV-D-05 (대표 승인 2026-09-02, 마이그레이션 007)
 *
 * 배경: `Conversation.unreadCount`를 설계서 4곳(DES-002 §4 · DES-004 공통 타입 ·
 * DES-006 SCR-CH11 · DES-013 §4-5)이 요구하는데 **읽음 상태를 저장할 자리가
 * 스키마에 없었다.** "파생값"이라 적혀 있었으나 파생할 원본이 없었다.
 *
 * 채택안: conversations.last_read_at 컬럼 하나. 사용자가 대표 한 명이므로
 * 채널당 포인터 하나면 충분하다 (메시지별 읽음 플래그는 과잉).
 */

let testDb: TestDb;
let service: ConversationService;
let repo: ConversationRepository;

beforeEach(() => {
  testDb = createTestDb();
  repo = new ConversationRepository(testDb.db);
  service = new ConversationService(repo, new MessageRepository(testDb.db));
});

afterEach(() => {
  testDb.close();
});

describe('unreadCount 계산', () => {
  it('한 번도 열지 않은 채널은 전체가 미읽음이다', async () => {
    // last_read_at이 NULL인 상태 — 마이그레이션 007의 기본값
    const id = seedMainChannel(testDb.db);
    seedMessage(testDb.db, id);
    seedMessage(testDb.db, id);
    seedMessage(testDb.db, id);

    expect((await service.getById(id)).unreadCount).toBe(3);
  });

  it('메시지가 없으면 0이다', async () => {
    const id = seedMainChannel(testDb.db);
    expect((await service.getById(id)).unreadCount).toBe(0);
  });

  it('읽은 뒤에는 0이 된다', async () => {
    const id = seedMainChannel(testDb.db);
    seedMessage(testDb.db, id, { createdAt: '2026-09-02T01:00:00.000Z' });
    seedMessage(testDb.db, id, { createdAt: '2026-09-02T02:00:00.000Z' });

    await service.markRead(id);

    expect((await service.getById(id)).unreadCount).toBe(0);
  });

  it('읽은 뒤 새로 온 것만 센다', async () => {
    const id = seedMainChannel(testDb.db);
    seedMessage(testDb.db, id, { createdAt: '2026-09-02T01:00:00.000Z' });

    repo.markRead(id, '2026-09-02T02:00:00.000Z');

    // 포인터 이후에 도착한 2건만 미읽음이다
    seedMessage(testDb.db, id, { createdAt: '2026-09-02T03:00:00.000Z' });
    seedMessage(testDb.db, id, { createdAt: '2026-09-02T04:00:00.000Z' });

    expect((await service.getById(id)).unreadCount).toBe(2);
  });

  it('포인터와 같은 시각의 메시지는 읽은 것으로 본다', async () => {
    const id = seedMainChannel(testDb.db);
    const at = '2026-09-02T02:00:00.000Z';
    seedMessage(testDb.db, id, { createdAt: at });

    repo.markRead(id, at);

    // 경계는 created_at > last_read_at 이다 (같으면 읽음)
    expect((await service.getById(id)).unreadCount).toBe(0);
  });

  it('목록 조회에도 채널별 미읽음이 실린다', async () => {
    const id = seedMainChannel(testDb.db);
    seedMessage(testDb.db, id);
    seedMessage(testDb.db, id);

    const list = await service.list({});
    expect(list.find((c) => c.id === id)?.unreadCount).toBe(2);
  });
});

describe('markRead', () => {
  it('포인터를 갱신하고 갱신된 채널을 돌려준다', async () => {
    const id = seedMainChannel(testDb.db);
    seedMessage(testDb.db, id);

    const before = await service.getById(id);
    expect(before.unreadCount).toBe(1);

    const after = await service.markRead(id);
    expect(after.id).toBe(id);
    expect(after.unreadCount).toBe(0);
  });

  it('없는 채널이면 404 CONVERSATION_NOT_FOUND', async () => {
    await expect(service.markRead(crypto.randomUUID())).rejects.toThrow(AppError);
  });

  it('여러 번 호출해도 안전하다', async () => {
    const id = seedMainChannel(testDb.db);
    seedMessage(testDb.db, id);

    await service.markRead(id);
    await service.markRead(id);

    expect((await service.getById(id)).unreadCount).toBe(0);
  });

  it('읽은 뒤 온 메시지는 다시 미읽음이 된다', async () => {
    const id = seedMainChannel(testDb.db);
    await service.markRead(id);

    // markRead가 isoNow()를 쓰므로 이후 시각으로 메시지를 넣는다
    const later = new Date(Date.parse(isoNow()) + 60_000).toISOString();
    seedMessage(testDb.db, id, { createdAt: later });

    expect((await service.getById(id)).unreadCount).toBe(1);
  });
});
