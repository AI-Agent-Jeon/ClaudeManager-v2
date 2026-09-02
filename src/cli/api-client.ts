import { type Dispatcher, request } from 'undici';
import { DEFAULT_HOST, DEFAULT_PORT, ErrorCode } from '../shared/constants.js';
import type { ErrorResponse } from '../shared/types.js';

/**
 * HTTP 클라이언트 래퍼 (undici)
 *
 * 정의 원본: DES-002 v2.4 §2(공통 규약)·§7(에러 코드 매핑) · DES-008 v3.1 §CLI Entry
 *
 * 이 계층의 핵심은 "에러 코드를 보존하는 것"이다. 서버가 내려준 `code`·`details`를
 * 그대로 호출부에 전달해야 CLI 명령이 HTTP 상태만 보고 뭉뚱그리지 않고 분기할 수
 * 있다 (예: `INVALID_TRANSITION`의 `allowedTransitions`를 DES-006 화면이 보여줘야 함).
 */

/** 서버가 에러 응답(4필드 + 선택 details)을 돌려준 경우 */
export class ApiRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * 서버 자체에 연결할 수 없는 경우 (ECONNREFUSED 등) — 대표가 가장 자주
 * 만나는 오류이므로 스택 트레이스 대신 안내 메시지를 낼 별도 타입으로 분리한다.
 */
export class ServerUnreachableError extends Error {
  constructor(readonly baseUrl: string) {
    super(`서버에 연결할 수 없습니다 (${baseUrl})`);
    this.name = 'ServerUnreachableError';
  }
}

export interface ApiClientOptions {
  /** 기본값: `resolveDefaultBaseUrl()` — `http://127.0.0.1:3000/api` */
  baseUrl?: string;
  token?: string | null;
  /** 테스트 전용 — undici `MockAgent`를 주입해 실제 소켓을 열지 않는다 */
  dispatcher?: Dispatcher;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * 기본 Base URL을 계산한다.
 *
 * 백엔드(`src/backend/config.ts`)와 같은 `CM_HOST`·`CM_PORT` 환경 변수를 그대로
 * 재사용한다 — CLI 전용 환경 변수를 새로 만들면 "서버는 `CM_PORT=3001`로
 * 띄웠는데 CLI는 3000을 본다"는 불일치가 생긴다 (DES-006 EVT-S01-3 참조).
 * Phase 1은 루프백 전용이므로 스킴은 항상 `http`다 (DES-002 §2-1).
 */
export function resolveDefaultBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.CM_HOST ?? DEFAULT_HOST;
  const port = env.CM_PORT ?? String(DEFAULT_PORT);
  return `http://${host}:${port}/api`;
}

export class ApiClient {
  readonly baseUrl: string;
  private token: string | null;
  private readonly dispatcher: Dispatcher | undefined;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? resolveDefaultBaseUrl();
    this.token = opts.token ?? null;
    this.dispatcher = opts.dispatcher;
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  get<T>(path: string): Promise<T> {
    return this.send<T>('GET', path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.send<T>('POST', path, body);
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.send<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.send<T>('DELETE', path);
  }

  /**
   * JSON 파싱 없이 원문 텍스트를 그대로 돌려준다.
   *
   * `GET /api/conversations/:id/export`는 이 코드베이스에서 **유일하게**
   * `{data:...}` 봉투를 쓰지 않고 `text/markdown`을 그대로 응답한다
   * (DES-002 §4). `send()`는 항상 `JSON.parse`를 시도하고 실패하면
   * `undefined`로 삼키므로(`parseJsonSafely`), 마크다운 본문을 그 경로로
   * 받으면 내용이 통째로 사라진다. 에러 응답(4xx)은 다른 엔드포인트와
   * 동일하게 JSON 에러 봉투이므로 그 경로는 `send()`와 같은 방식으로
   * 처리한다.
   */
  async getText(path: string): Promise<string> {
    const headers: Record<string, string> = { accept: 'text/markdown, application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    let res: Dispatcher.ResponseData;
    try {
      res = await request(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers,
        dispatcher: this.dispatcher,
      });
    } catch (cause) {
      if (isConnectionRefused(cause)) {
        throw new ServerUnreachableError(this.baseUrl);
      }
      throw cause;
    }

    const text = await res.body.text();

    if (res.statusCode >= 400) {
      const json = parseJsonSafely(text);
      const err = (json ?? {}) as Partial<ErrorResponse>;
      throw new ApiRequestError(
        err.statusCode ?? res.statusCode,
        err.code ?? ErrorCode.INTERNAL_ERROR,
        err.message ?? '알 수 없는 오류가 발생했습니다',
        err.details,
      );
    }

    return text;
  }

  private async send<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    // 인증 불필요 경로(login·health)도 헤더를 실어 보내도 무해하다 — 그 라우트들은
    // authenticate 훅을 걸지 않는다 (src/backend/app.ts 등록 순서 참조).
    if (this.token) headers.authorization = `Bearer ${this.token}`;

    let res: Dispatcher.ResponseData;
    try {
      res = await request(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        dispatcher: this.dispatcher,
      });
    } catch (cause) {
      if (isConnectionRefused(cause)) {
        throw new ServerUnreachableError(this.baseUrl);
      }
      throw cause;
    }

    const text = await res.body.text();
    const json = parseJsonSafely(text);

    if (res.statusCode >= 400) {
      const err = (json ?? {}) as Partial<ErrorResponse>;
      throw new ApiRequestError(
        err.statusCode ?? res.statusCode,
        err.code ?? ErrorCode.INTERNAL_ERROR,
        err.message ?? '알 수 없는 오류가 발생했습니다',
        err.details,
      );
    }

    return json as T;
  }
}

function parseJsonSafely(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // 서버가 JSON이 아닌 본문을 돌려준 예외 상황 — 원문을 그대로 노출하지 않는다
    // (backend/utils/errors.ts와 같은 원칙: 내부 오류 원문 비노출)
    return undefined;
  }
}

/** ECONNREFUSED는 원인 체인 어딘가에 있을 수 있어 몇 단계까지 훑는다 */
function isConnectionRefused(cause: unknown): boolean {
  let err: unknown = cause;
  for (let i = 0; i < 5 && err; i++) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      if ((err as { code?: unknown }).code === 'ECONNREFUSED') return true;
    }
    err =
      typeof err === 'object' && err !== null && 'cause' in err
        ? (err as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}
