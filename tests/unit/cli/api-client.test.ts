import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ApiClient,
  ApiRequestError,
  resolveDefaultBaseUrl,
  ServerUnreachableError,
} from '../../../src/cli/api-client.js';

/**
 * HTTP 클라이언트 래퍼 — 수용 기준
 *   Given 성공 응답 When 호출 Then data를 그대로 파싱한다
 *   Given 에러 응답 When 호출 Then 서버 에러 코드·details를 보존한다
 *   Given 서버 미기동 When 호출 Then ServerUnreachableError로 구분한다
 *
 * 정의 원본: DES-002 v2.4 §2-3(응답 형식)·§7(에러 코드 매핑) · DEV-D-04(details)
 *
 * undici `MockAgent`를 `dispatcher`로 주입한다 — 실제 소켓을 열지 않고,
 * 코드베이스에 기존 HTTP 목킹 관례가 없어 undici 표준 도구를 그대로 쓴다.
 */

const ORIGIN = 'http://127.0.0.1:3000';
const BASE_URL = `${ORIGIN}/api`;

let mockAgent: MockAgent;

beforeEach(() => {
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
});

afterEach(async () => {
  await mockAgent.close();
});

describe('resolveDefaultBaseUrl', () => {
  it('환경 변수가 없으면 http://127.0.0.1:3000/api다', () => {
    expect(resolveDefaultBaseUrl({})).toBe('http://127.0.0.1:3000/api');
  });

  it('CM_HOST·CM_PORT로 덮어쓸 수 있다', () => {
    expect(resolveDefaultBaseUrl({ CM_HOST: '10.0.0.1', CM_PORT: '4000' })).toBe(
      'http://10.0.0.1:4000/api',
    );
  });
});

describe('ApiClient — 성공 응답', () => {
  it('GET 단일 응답의 data를 그대로 돌려준다', async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({ path: '/api/health', method: 'GET' })
      .reply(200, { data: { status: 'ok' } });

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });
    const res = await client.get<{ data: { status: string } }>('/health');

    expect(res.data.status).toBe('ok');
  });

  it('POST 요청 본문을 JSON으로 보낸다', async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        path: '/api/auth/login',
        method: 'POST',
        body: JSON.stringify({ secret: 's' }),
      })
      .reply(200, { data: { token: 't', expiresAt: '2026-09-09T00:00:00.000Z' } });

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });
    const res = await client.post<{ data: { token: string } }>('/auth/login', { secret: 's' });

    expect(res.data.token).toBe('t');
  });

  it('토큰이 있으면 Authorization 헤더를 싣는다', async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({
        path: '/api/projects',
        method: 'GET',
        headers: { authorization: 'Bearer abc.def.ghi' },
      })
      .reply(200, { data: [] });

    const client = new ApiClient({
      baseUrl: BASE_URL,
      dispatcher: mockAgent,
      token: 'abc.def.ghi',
    });
    const res = await client.get<{ data: unknown[] }>('/projects');

    expect(res.data).toEqual([]);
  });
});

describe('ApiClient — 에러 코드 보존', () => {
  it('서버 에러 코드를 statusCode·code 그대로 던진다 (401)', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/api/auth/login', method: 'POST' }).reply(401, {
      statusCode: 401,
      error: 'Unauthorized',
      message: '시크릿이 올바르지 않습니다',
      code: 'AUTH_INVALID_SECRET',
    });

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });

    await expect(client.post('/auth/login', { secret: 'wrong' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'AUTH_INVALID_SECRET',
    });
  });

  it('ApiRequestError 인스턴스를 던진다', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/api/status-changes', method: 'GET' }).reply(401, {
      statusCode: 401,
      error: 'Unauthorized',
      message: '인증이 필요합니다',
      code: 'UNAUTHORIZED',
    });

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });

    await expect(client.get('/status-changes')).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('details 필드를 보존한다 (DEV-D-04 — 허용 전이 목록)', async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({ path: '/api/projects/x/status', method: 'PATCH' })
      .reply(422, {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: '허용되지 않는 상태 전이입니다',
        code: 'INVALID_TRANSITION',
        details: { allowedTransitions: ['running', 'cancelled'] },
      });

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });

    try {
      await client.patch('/projects/x/status', { status: 'completed' });
      throw new Error('던져야 한다');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).details).toEqual({
        allowedTransitions: ['running', 'cancelled'],
      });
    }
  });

  it('details가 없는 응답은 undefined다 — 평소 4필드 그대로', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/api/projects', method: 'POST' }).reply(400, {
      statusCode: 400,
      error: 'Bad Request',
      message: '프로젝트 이름은 필수입니다',
      code: 'VALIDATION_ERROR',
    });

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });

    try {
      await client.post('/projects', {});
      throw new Error('던져야 한다');
    } catch (err) {
      expect((err as ApiRequestError).details).toBeUndefined();
    }
  });
});

describe('ApiClient — 서버 미기동', () => {
  it('ECONNREFUSED는 ServerUnreachableError로 구분한다', async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({ path: '/api/health', method: 'GET' })
      .replyWithError(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), {
          code: 'ECONNREFUSED',
        }),
      );

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });

    await expect(client.get('/health')).rejects.toBeInstanceOf(ServerUnreachableError);
  });

  it('ServerUnreachableError 메시지에 baseUrl을 포함한다 — 스택 트레이스 대신 안내', async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({ path: '/api/health', method: 'GET' })
      .replyWithError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });

    try {
      await client.get('/health');
      throw new Error('던져야 한다');
    } catch (err) {
      expect(err).toBeInstanceOf(ServerUnreachableError);
      expect((err as ServerUnreachableError).message).toContain(BASE_URL);
    }
  });

  it('ECONNREFUSED가 아닌 네트워크 오류는 그대로 던진다', async () => {
    mockAgent
      .get(ORIGIN)
      .intercept({ path: '/api/health', method: 'GET' })
      .replyWithError(new Error('boom'));

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });

    await expect(client.get('/health')).rejects.not.toBeInstanceOf(ServerUnreachableError);
  });
});

describe('ApiClient — 빈 본문', () => {
  it('204처럼 본문이 없는 응답도 에러 없이 처리한다', async () => {
    mockAgent.get(ORIGIN).intercept({ path: '/api/agents/x', method: 'DELETE' }).reply(200, '');

    const client = new ApiClient({ baseUrl: BASE_URL, dispatcher: mockAgent });
    const res = await client.delete('/agents/x');

    expect(res).toBeUndefined();
  });
});
