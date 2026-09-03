/**
 * API 클라이언트 — Phase 2A 웹 UI
 *
 * 백엔드 REST 34종을 그대로 쓴다. 라우트·스키마는 건드리지 않는다
 * (develop 위임 §반드시 지킬 것 1).
 *
 * 토큰은 localStorage에 저장하고 Authorization: Bearer로 보낸다(§3).
 * 401을 받으면 토큰을 지우고 `onUnauthorized` 콜백을 호출한다 — App이
 * 이 콜백에서 로그인 화면으로 돌린다.
 */

import type { ErrorResponse } from '../../../shared/types.js';

const TOKEN_KEY = 'cm_token';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    // localStorage가 막힌 환경(사생활 보호 모드 등) — 로그인 화면으로 유도된다
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 저장 실패해도 이번 세션 진행은 막지 않는다 — 새로고침 시 재로그인만 필요
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // no-op
  }
}

/** 서버가 죽었거나 응답 자체가 없을 때(ECONNREFUSED 등) 구분용 */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('서버에 연결할 수 없습니다. 서버가 켜져 있는지 확인하세요.');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export class ApiError extends Error {
  statusCode: number;
  code: string;

  constructor(body: ErrorResponse) {
    super(body.message);
    this.name = 'ApiError';
    this.statusCode = body.statusCode;
    this.code = body.code;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** 로그인 요청 등 인증 헤더를 붙이면 안 되는 호출용 */
  skipAuth?: boolean;
}

/**
 * 공통 fetch 래퍼.
 * - 항상 4필드 에러 형식(DES-009)을 가정하고 파싱한다.
 * - 401이면 토큰을 지우고 로그인 화면으로 돌린다(§3).
 * - fetch 자체가 실패하면(NetworkError) 화면에 "서버 연결 실패"를 보여준다(§4).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, skipAuth = false } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!skipAuth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new NetworkError(cause);
  }

  if (response.status === 401) {
    clearToken();
    onUnauthorized?.();
  }

  if (!response.ok) {
    let errorBody: ErrorResponse;
    try {
      errorBody = (await response.json()) as ErrorResponse;
    } catch {
      throw new ApiError({
        statusCode: response.status,
        error: response.statusText,
        message: `요청이 실패했습니다 (HTTP ${response.status})`,
        code: 'UNKNOWN_ERROR',
      });
    }
    throw new ApiError(errorBody);
  }

  // 204 등 본문 없는 응답
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
