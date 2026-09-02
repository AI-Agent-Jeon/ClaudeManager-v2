import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';
import {
  isoNow,
  seedAgent,
  seedAgentChannel,
  seedMainChannel,
  seedMessage,
  seedProject,
} from '../../../fixtures/test-db.js';

/**
 * conversations.routes — FR-026 · FR-027 (REST 5종)
 *
 * 정의 원본: DES-002 v2.2 §3-2 · §4 · DES-004 v2.2 §14
 */

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

function authHeader() {
  return { authorization: `Bearer ${token}` };
}

describe('GET /api/conversations — FR-026', () => {
  it('Given CH-MAIN이 있을 때 When type=main으로 조회하면 Then 1건이 반환된다 (main 별칭 경로 없이 id를 얻는 대체 경로)', async () => {
    const mainId = seedMainChannel(app.db);

    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations?type=main',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(mainId);
    expect(body.data[0].title).toBe('Main');
  });

  it('Given active·archived 채널이 섞여 있을 때 When status 지정 없이 조회하면 Then active만 반환된다', async () => {
    seedMainChannel(app.db);
    const projectId = seedProject(app.db);
    const agentId = seedAgent(app.db, projectId);
    const archivedId = seedAgentChannel(app.db, agentId);
    app.db.prepare("UPDATE conversations SET status = 'archived' WHERE id = ?").run(archivedId);

    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: authHeader(),
    });

    const ids = res.json().data.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(archivedId);
  });

  it('아카이브 채널의 title이 entitySnapshot에서 나온다 — Agent 행이 삭제되어도 표시된다 (D-27)', async () => {
    const projectId = seedProject(app.db);
    const agentId = seedAgent(app.db, projectId, { name: '삭제될에이전트' });
    const convId = seedAgentChannel(app.db, agentId);

    app.db
      .prepare(
        "UPDATE conversations SET status = 'archived', entity_snapshot = ?, archived_at = ? WHERE id = ?",
      )
      .run(
        JSON.stringify({ agent_name: '삭제될에이전트', project_name: 'p', agent_type: 'dev' }),
        isoNow(),
        convId,
      );
    // D-27 — Agent 행 자체가 삭제되어도 채널 목록에 이름이 나와야 한다
    app.db.prepare('DELETE FROM agents WHERE id = ?').run(agentId);

    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations?status=archived',
      headers: authHeader(),
    });

    const found = res.json().data.find((c: { id: string }) => c.id === convId);
    expect(found?.title).toBe('삭제될에이전트');
  });

  it('정의되지 않은 쿼리 필드를 실으면 400 (additionalProperties: false)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations?bogus=1',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/conversations' });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/conversations/:id/messages — 커서 페이지네이션 (FR-027)', () => {
  it('Given 존재하지 않는 채널 When 메시지 조회하면 Then 404 CONVERSATION_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${crypto.randomUUID()}/messages`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('limit보다 메시지가 많으면 hasMore=true, next 커서가 채워진다', async () => {
    const convId = seedMainChannel(app.db);
    for (let i = 0; i < 5; i++) {
      seedMessage(app.db, convId, { createdAt: new Date(2024, 0, 1, 0, 0, i).toISOString() });
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${convId}/messages?limit=3`,
      headers: authHeader(),
    });

    const body = res.json();
    expect(body.data).toHaveLength(3);
    expect(body.cursor.hasMore).toBe(true);
    expect(body.cursor.next).not.toBeNull();
  });

  it('커서로 이어 조회하면 중복·누락 없이 전건이 순회된다', async () => {
    const convId = seedMainChannel(app.db);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(
        seedMessage(app.db, convId, { createdAt: new Date(2024, 0, 1, 0, 0, i).toISOString() }),
      );
    }

    const collected: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const url = cursor
        ? `/api/conversations/${convId}/messages?limit=3&cursor=${encodeURIComponent(cursor)}`
        : `/api/conversations/${convId}/messages?limit=3`;
      const res = await app.inject({ method: 'GET', url, headers: authHeader() });
      const body = res.json();
      collected.push(...body.data.map((m: { id: string }) => m.id));
      if (!body.cursor.hasMore) break;
      cursor = body.cursor.next;
    }

    expect(collected).toHaveLength(7);
    expect(new Set(collected).size).toBe(7);
  });
});

describe('POST /api/conversations/:id/messages — FR-027', () => {
  it('Given active 채널일 때 When 본문을 보내면 Then 201과 MSG-01/ceo 고정 메시지가 반환된다', async () => {
    const convId = seedMainChannel(app.db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${convId}/messages`,
      headers: authHeader(),
      payload: { body: '대화 기능부터 진행해줘' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json().data;
    expect(body.msgType).toBe('MSG-01');
    expect(body.senderRole).toBe('ceo');
    expect(body.body).toBe('대화 기능부터 진행해줘');
  });

  it('senderRole 주입을 시도하면 400 — additionalProperties: false가 막는다', async () => {
    const convId = seedMainChannel(app.db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${convId}/messages`,
      headers: authHeader(),
      payload: { body: '위장 시도', senderRole: 'agent' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('msgType 주입을 시도하면 400', async () => {
    const convId = seedMainChannel(app.db);

    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${convId}/messages`,
      headers: authHeader(),
      payload: { body: '위장 시도', msgType: 'MSG-03' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('Given readonly 채널일 때 When 발화하면 Then 409 CONVERSATION_ARCHIVED', async () => {
    const projectId = seedProject(app.db);
    const agentId = seedAgent(app.db, projectId);
    const convId = seedAgentChannel(app.db, agentId);
    app.db.prepare("UPDATE conversations SET status = 'readonly' WHERE id = ?").run(convId);

    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${convId}/messages`,
      headers: authHeader(),
      payload: { body: '실패해야함' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONVERSATION_ARCHIVED');
  });

  it('Given archived 채널일 때 When 발화하면 Then 409 CONVERSATION_ARCHIVED. 조회는 여전히 허용된다', async () => {
    const projectId = seedProject(app.db);
    const agentId = seedAgent(app.db, projectId);
    const convId = seedAgentChannel(app.db, agentId);
    app.db.prepare("UPDATE conversations SET status = 'archived' WHERE id = ?").run(convId);

    const sendRes = await app.inject({
      method: 'POST',
      url: `/api/conversations/${convId}/messages`,
      headers: authHeader(),
      payload: { body: '실패해야함' },
    });
    expect(sendRes.statusCode).toBe(409);

    const readRes = await app.inject({
      method: 'GET',
      url: `/api/conversations/${convId}/messages`,
      headers: authHeader(),
    });
    expect(readRes.statusCode).toBe(200);
  });

  it('Given 존재하지 않는 채널 When 발화하면 Then 404 CONVERSATION_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${crypto.randomUUID()}/messages`,
      headers: authHeader(),
      payload: { body: '없는채널' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('body 누락 시 400 VALIDATION_ERROR', async () => {
    const convId = seedMainChannel(app.db);
    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${convId}/messages`,
      headers: authHeader(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/conversations/search — FR-027 FTS5', () => {
  it('검색어로 메시지를 찾고 snippet을 돌려준다', async () => {
    const convId = seedMainChannel(app.db);
    // unicode61 토크나이저는 공백 기준으로 자른다 — 조사가 붙은 "설계서를"은
    // "설계서" 검색에 걸리지 않는다(DES-003 §3-3 미해결 사항). 독립된 어절로 검증한다.
    seedMessage(app.db, convId, { body: 'DES-003 설계 문서를 개정했습니다' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations/search?q=설계',
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].snippet).toContain('<mark>');
    expect(body.data[0].conversationTitle).toBe('Main');
  });

  it('q가 2자 미만이면 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations/search?q=a',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('q 누락 시 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations/search',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/conversations/:id/export — FR-027', () => {
  it('Content-Type이 text/markdown이고 응답 봉투를 쓰지 않는다', async () => {
    const convId = seedMainChannel(app.db);
    seedMessage(app.db, convId, { body: '내보낼 본문' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${convId}/export`,
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/markdown');
    expect(res.body).toContain('내보낼 본문');
    // {data:...} 봉투가 아니라 마크다운 원문 그대로다
    expect(() => JSON.parse(res.body)).toThrow();
  });

  it('Given 존재하지 않는 채널 When 내보내면 Then 404 CONVERSATION_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${crypto.randomUUID()}/export`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('CONVERSATION_NOT_FOUND');
  });
});
