import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../../../src/backend/app.js';

/**
 * FR-001 서버 시작/종료 · FR-002 토큰 기반 인증 · NFR-002 인증 미들웨어
 *
 * app.inject()를 쓴다 — 포트를 열지 않으므로 테스트가 서로 간섭하지 않는다.
 */

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({
    config: { dbPath: ':memory:', authSecret: 'test-secret', jwtExpiresIn: '7d' },
  });
});

afterEach(async () => {
  await app.close();
});

async function login(secret = 'test-secret') {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { secret } });
}

describe('GET /api/health — FR-001', () => {
  it('Given 서버 실행 중 When 헬스체크 Then 200과 상태를 돌려준다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe('ok');
    expect(body.data.database).toBe('connected');
    expect(typeof body.data.uptime).toBe('number');
    expect(typeof body.data.version).toBe('string');
  });

  it('인증이 필요 없다 (DES-002 §2-2)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).not.toBe(401);
  });
});

describe('POST /api/auth/login — FR-002', () => {
  it('Given 올바른 시크릿 When 로그인 Then 토큰이 발급된다', async () => {
    const res = await login();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.data.token).toBe('string');
    expect(body.data.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('Given 잘못된 시크릿 When 로그인 Then 401이 반환된다', async () => {
    const res = await login('wrong-secret');

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_INVALID_SECRET');
  });

  it('secret 누락은 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('정의되지 않은 필드를 실으면 거부한다 (additionalProperties: false)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { secret: 'test-secret', role: 'admin' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('인증 미들웨어 — NFR-002', () => {
  it('Given 토큰 없이 When 보호된 API 요청 Then 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status-changes' });

    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('Given 유효한 토큰으로 When 보호된 API 요청 Then 401이 아니다', async () => {
    const token = (await login()).json().data.token;
    const res = await app.inject({
      method: 'GET',
      url: '/api/status-changes',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).not.toBe(401);
  });

  it('망가진 토큰은 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/status-changes',
      headers: { authorization: 'Bearer not.a.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('Bearer 접두어가 없으면 401', async () => {
    const token = (await login()).json().data.token;
    const res = await app.inject({
      method: 'GET',
      url: '/api/status-changes',
      headers: { authorization: token },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('에러 응답 형식 — DES-009 §HTTP 에러 응답', () => {
  it('4필드를 갖춘다', async () => {
    const body = (await login('wrong')).json();
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'message', 'statusCode']);
  });

  it('없는 경로는 404 NOT_FOUND', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nowhere' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });
});

describe('SEC-07/REV-M-04 — Fastify 자체 에러도 무조건 500이 아니라 원래 statusCode를 쓴다', () => {
  async function authHeader(): Promise<{ authorization: string }> {
    const token = (await login()).json().data.token;
    return { authorization: `Bearer ${token}` };
  }

  it('파손된 JSON 본문은 500이 아니라 400 VALIDATION_ERROR다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...(await authHeader()), 'content-type': 'application/json' },
      payload: '{',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('본문 크기 초과는 500이 아니라 413이다', async () => {
    // 기본 bodyLimit(1MiB)을 넘긴다 — 별도 설정을 하지 않았으므로 Fastify 기본값이다
    const oversized = 'a'.repeat(2 * 1024 * 1024);
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...(await authHeader()), 'content-type': 'application/json' },
      payload: JSON.stringify({ name: oversized }),
    });
    expect(res.statusCode).toBe(413);
  });

  it('지원하지 않는 미디어 타입은 500이 아니라 415다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...(await authHeader()), 'content-type': 'application/xml' },
      payload: '<project/>',
    });
    expect(res.statusCode).toBe(415);
  });
});

describe('부팅 — DAT-001 · DAT-002', () => {
  it('Given DB 파일이 없을 때 When 서버를 시작하면 Then 스키마가 적용된다', () => {
    const tables = app.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toContain('projects');
    expect(tables).toContain('approvals');
    expect(tables).toContain('_migrations');
  });

  it('Given DB 연결 실패 When 서버 시작 Then 에러와 함께 중단된다', async () => {
    // 디렉토리를 DB 파일로 열 수는 없다 — 플랫폼 무관하게 실패한다
    await expect(
      buildApp({ config: { dbPath: './src', authSecret: 's', jwtExpiresIn: '7d' } }),
    ).rejects.toThrow();
  });
});
