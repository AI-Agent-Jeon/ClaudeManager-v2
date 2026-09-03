import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';
import {
  BootstrapService,
  buildBootstrapService,
} from '../../../../src/backend/bootstrap/bootstrap.service.js';
import { ConversationRepository } from '../../../../src/backend/repositories/conversation.repository.js';
import { MessageRepository } from '../../../../src/backend/repositories/message.repository.js';
import { PhaseRepository } from '../../../../src/backend/repositories/phase.repository.js';
import { ConversationService } from '../../../../src/backend/services/conversation.service.js';
import { PhaseService } from '../../../../src/backend/services/phase.service.js';
import { createTestDb, type TestDb } from '../../../fixtures/test-db.js';

/**
 * BootstrapService (R-1)
 *
 * 정의 원본: DES-004 v2.2 §18 · DES-002 v2.1 §5-1 · DES-001 v3.2 §기동 순서 5단계
 *
 * 핵심 방어선: `seed()`를 연속 호출해도 CH-MAIN 1행·Phase 1행·stages 7행만
 * 존재해야 한다(멱등성). 그 외 회귀 — 부트스트랩 없이는 실패했던
 * `GET /api/phases/current`·CH-MAIN 조회가 시드 후 실제로 성공하는지 확인한다.
 */

let testDb: TestDb;
let conversationRepo: ConversationRepository;
let phaseRepo: PhaseRepository;
let service: BootstrapService;

beforeEach(() => {
  testDb = createTestDb();
  conversationRepo = new ConversationRepository(testDb.db);
  phaseRepo = new PhaseRepository(testDb.db);

  const conversationService = new ConversationService(
    conversationRepo,
    new MessageRepository(testDb.db),
  );
  const phaseService = new PhaseService(testDb.db, phaseRepo);
  service = new BootstrapService(conversationService, phaseService);
});

afterEach(() => {
  testDb.close();
});

function countRows(table: string, where = ''): number {
  return (testDb.db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get() as { n: number })
    .n;
}

describe('BootstrapService.seed — 멱등성 (R-1 핵심 방어선)', () => {
  it('연속 3회 호출해도 CH-MAIN 1행 · Phase 1행 · stages 7행만 존재한다', async () => {
    const first = await service.seed();
    const second = await service.seed();
    const third = await service.seed();

    expect(second.mainChannelId).toBe(first.mainChannelId);
    expect(third.mainChannelId).toBe(first.mainChannelId);
    expect(second.phaseId).toBe(first.phaseId);
    expect(third.phaseId).toBe(first.phaseId);

    expect(countRows('conversations', "WHERE channel_type = 'main'")).toBe(1);
    expect(countRows('phases')).toBe(1);
    expect(countRows('stages', `WHERE phase_id = '${first.phaseId}'`)).toBe(7);
  });

  it('Phase 1의 이름은 "기반 구축"이고 7단계가 전부 pending이다', async () => {
    const { phaseId } = await service.seed();

    const phase = phaseRepo.findCurrentPhase();
    expect(phase?.number).toBe(1);
    expect(phase?.name).toBe('기반 구축');

    const stages = testDb.db
      .prepare('SELECT status FROM stages WHERE phase_id = ?')
      .all(phaseId) as { status: string }[];
    expect(stages.length).toBe(7);
    expect(stages.every((s) => s.status === 'pending')).toBe(true);
  });

  it('이미 데이터가 있는 DB에서 기존 행을 덮어쓰지 않는다', async () => {
    const { mainChannelId, phaseId } = await service.seed();

    // 이미 있던 채널·Phase에 손을 대지 않았는지 원본 생성 시각으로 확인한다
    const before = testDb.db
      .prepare('SELECT created_at FROM conversations WHERE id = ?')
      .get(mainChannelId) as { created_at: string };
    const phaseBefore = testDb.db
      .prepare('SELECT started_at FROM phases WHERE id = ?')
      .get(phaseId) as { started_at: string };

    await service.seed();

    const after = testDb.db
      .prepare('SELECT created_at FROM conversations WHERE id = ?')
      .get(mainChannelId) as { created_at: string };
    const phaseAfter = testDb.db
      .prepare('SELECT started_at FROM phases WHERE id = ?')
      .get(phaseId) as { started_at: string };

    expect(after.created_at).toBe(before.created_at);
    expect(phaseAfter.started_at).toBe(phaseBefore.started_at);
  });

  it('시드 중 실패하면 던진다 — 호출자가 기동을 중단할 수 있어야 한다', async () => {
    const failingPhaseService = {
      ensurePhase: () => {
        throw new Error('시뮬레이션된 시드 실패');
      },
    } as unknown as PhaseService;
    const conversationService = new ConversationService(
      conversationRepo,
      new MessageRepository(testDb.db),
    );
    const failingService = new BootstrapService(conversationService, failingPhaseService);

    await expect(failingService.seed()).rejects.toThrow('시뮬레이션된 시드 실패');
  });
});

describe('부트스트랩 회귀 — 시드 없이는 실패했던 조회가 시드 후 성공한다', () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    app = await buildApp({
      config: { dbPath: ':memory:', authSecret: 'test-secret', jwtExpiresIn: '7d' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { secret: 'test-secret' },
    });
    token = res.json().data.token;
  });

  afterEach(async () => {
    await app.close();
  });

  it('빈 DB에서 시드 후 GET /api/phases/current와 CH-MAIN 조회가 실제로 성공한다', async () => {
    // buildApp()은 부트스트랩을 호출하지 않는다 — 시드 전에는 둘 다 실패해야 한다
    const beforePhase = await app.inject({
      method: 'GET',
      url: '/api/phases/current',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(beforePhase.statusCode).toBe(404);

    const beforeConv = await app.inject({
      method: 'GET',
      url: '/api/conversations?type=main',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(beforeConv.json().data).toEqual([]);

    const conversationService = new ConversationService(
      new ConversationRepository(app.db),
      new MessageRepository(app.db),
    );
    const phaseService = new PhaseService(app.db, new PhaseRepository(app.db));
    await new BootstrapService(conversationService, phaseService).seed();

    const afterPhase = await app.inject({
      method: 'GET',
      url: '/api/phases/current',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterPhase.statusCode).toBe(200);
    expect(afterPhase.json().data.phase.number).toBe(1);

    const afterConv = await app.inject({
      method: 'GET',
      url: '/api/conversations?type=main',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterConv.json().data.length).toBe(1);
    expect(afterConv.json().data[0].channelType).toBe('main');
  });

  it('buildBootstrapService(app)로 조립해도 동일하게 시드된다', async () => {
    const { mainChannelId, phaseId } = await buildBootstrapService(app).seed();
    expect(mainChannelId).toBeTruthy();
    expect(phaseId).toBeTruthy();

    const res = await app.inject({
      method: 'GET',
      url: '/api/phases/current',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
