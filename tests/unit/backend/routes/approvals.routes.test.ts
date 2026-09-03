import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';
import { seedMainChannel } from '../../../fixtures/test-db.js';

/**
 * FR-028 · FR-030 — approvals.routes
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5 · DES-004 v2.4 §15~17
 *
 * 부트스트랩(R-01 · CH-MAIN 자동 생성)은 이 계층(2-6) 범위 밖이라 아직 서버
 * 기동 시 시드되지 않는다 — 각 테스트가 `seedMainChannel`로 채널을 직접 만든다.
 */

let app: FastifyInstance;
let token: string;
let mainChannelId: string;

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
  mainChannelId = seedMainChannel(app.db);
});

afterEach(async () => {
  await app.close();
});

function authHeader() {
  return { authorization: `Bearer ${token}` };
}

async function createApproval(
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: { data: unknown; code?: string } }> {
  const conversationId = overrides.conversationId ?? mainChannelId;
  const res = await app.inject({
    method: 'POST',
    url: '/api/approvals',
    headers: authHeader(),
    payload: {
      approvalType: 'APV-CHOICE',
      level: 'high',
      subject: '테스트 안건',
      options: [
        { code: 'A', label: '승인' },
        { code: 'B', label: '반려' },
      ],
      requestedBy: 'main',
      ...overrides,
      conversationId,
    },
  });
  return { status: res.statusCode, body: res.json() };
}

describe('POST /api/approvals — R-07', () => {
  it('Given 유효한 요청일 때 When 승인 건을 상정하면 Then 201과 pending 상태가 반환된다', async () => {
    const { status, body } = await createApproval();
    expect(status).toBe(201);
    const data = body.data as { status: string; deadlineAt: string | null; level: string };
    expect(data.status).toBe('pending');
    expect(data.deadlineAt).toBeNull();
    expect(data.level).toBe('high');
  });

  it("level='low'는 400 VALIDATION_ERROR — 스키마 enum이 high·medium만 허용한다", async () => {
    const { status, body } = await createApproval({ level: 'low' });
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('additionalProperties: false — deadlineAt을 실어 보내면 400으로 거부된다', async () => {
    const conversationId = mainChannelId;
    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      headers: authHeader(),
      payload: {
        approvalType: 'APV-CHOICE',
        level: 'high',
        subject: '기한 주입 시도',
        options: [{ code: 'A', label: '승인' }],
        requestedBy: 'main',
        conversationId,
        deadlineAt: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('존재하지 않는 conversationId면 404 CONVERSATION_NOT_FOUND', async () => {
    const { status, body } = await createApproval({ conversationId: crypto.randomUUID() });
    expect(status).toBe(404);
    expect(body.code).toBe('CONVERSATION_NOT_FOUND');
  });

  it('인증 없이 요청하면 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/approvals',
      payload: {
        approvalType: 'APV-CHOICE',
        level: 'high',
        subject: '무인증',
        options: [{ code: 'A', label: '승인' }],
        requestedBy: 'main',
        conversationId: crypto.randomUUID(),
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/approvals — FR-028', () => {
  it('Given 승인 건이 있을 때 When 목록 조회하면 Then 반환된다', async () => {
    await createApproval({ subject: '목록 확인용' });

    const res = await app.inject({ method: 'GET', url: '/api/approvals', headers: authHeader() });
    expect(res.statusCode).toBe(200);
    const items = res.json().data as { subject: string }[];
    expect(items.some((a) => a.subject === '목록 확인용')).toBe(true);
  });

  it('status 쿼리로 필터링된다', async () => {
    await createApproval({ subject: 'pending 건' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/approvals?status=approved',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("level 쿼리에 'low'를 주면 400 — 적재되지 않는 값이라 필터 enum에 없다", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/approvals?level=low',
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/approvals/:id — FR-028', () => {
  it('Given 승인 건이 존재할 때 When 상세 조회하면 Then options·artifacts·rationale·impact를 포함한다', async () => {
    const created = (await createApproval({ subject: '상세 확인용' })).body.data as { id: string };

    const res = await app.inject({
      method: 'GET',
      url: `/api/approvals/${created.id}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json().data;
    expect(detail.options.length).toBe(2);
    expect(detail.artifacts).toEqual([]);
    expect(detail.messageId).toBeTruthy();
  });

  it('Given 존재하지 않는 id When 상세 조회하면 Then 404 APPROVAL_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/approvals/${crypto.randomUUID()}`,
      headers: authHeader(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('APPROVAL_NOT_FOUND');
  });
});

describe('POST /api/approvals/:id/resolve — FR-028', () => {
  it('Given pending 승인 건일 때 When approved로 처리하면 Then 200과 approved 상태가 반환된다', async () => {
    const created = (await createApproval({ subject: '승인 처리용' })).body.data as { id: string };

    const res = await app.inject({
      method: 'POST',
      url: `/api/approvals/${created.id}/resolve`,
      headers: authHeader(),
      payload: { resolution: 'A', status: 'approved', reason: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('approved');
  });

  it('rejected인데 reason이 없으면 400 (스키마 allOf가 먼저 걸러낸다)', async () => {
    const created = (await createApproval({ subject: '반려 사유 누락' })).body.data as {
      id: string;
    };

    const res = await app.inject({
      method: 'POST',
      url: `/api/approvals/${created.id}/resolve`,
      headers: authHeader(),
      payload: { resolution: 'B', status: 'rejected' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('이미 처리된 건을 다시 처리하면 409 APPROVAL_ALREADY_RESOLVED', async () => {
    const created = (await createApproval({ subject: '중복 처리' })).body.data as { id: string };
    await app.inject({
      method: 'POST',
      url: `/api/approvals/${created.id}/resolve`,
      headers: authHeader(),
      payload: { resolution: 'A', status: 'approved' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/approvals/${created.id}/resolve`,
      headers: authHeader(),
      payload: { resolution: 'A', status: 'approved' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('APPROVAL_ALREADY_RESOLVED');
  });

  it("enum에 'auto_advanced'가 없어 API로 자동 진행을 호출할 수 없다 (400)", async () => {
    const created = (await createApproval({ subject: '자동진행 차단' })).body.data as {
      id: string;
    };

    const res = await app.inject({
      method: 'POST',
      url: `/api/approvals/${created.id}/resolve`,
      headers: authHeader(),
      payload: { status: 'auto_advanced' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('Given 존재하지 않는 id When resolve하면 Then 404 APPROVAL_NOT_FOUND', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/approvals/${crypto.randomUUID()}/resolve`,
      headers: authHeader(),
      payload: { status: 'approved' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('APPROVAL_NOT_FOUND');
  });
});
