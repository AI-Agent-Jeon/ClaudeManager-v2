/**
 * 오늘 범위(4화면)에 쓰는 엔드포인트만 얇게 감싼다. 새 엔드포인트가
 * 필요해지면 여기 추가한다 — 백엔드 라우트는 건드리지 않는다.
 */

import type {
  Agent,
  ApiResponse,
  Conversation,
  CursorResponse,
  ListMessagesOpts,
  LoginResponse,
  Message,
  PaginatedResponse,
  PhaseCurrent,
  Task,
} from '../../../shared/types.js';
import { apiRequest } from './client';

export function login(secret: string): Promise<ApiResponse<LoginResponse>> {
  return apiRequest('/api/auth/login', { method: 'POST', body: { secret }, skipAuth: true });
}

export function getPhaseCurrent(): Promise<ApiResponse<PhaseCurrent>> {
  return apiRequest('/api/phases/current');
}

export function listAgents(): Promise<PaginatedResponse<Agent>> {
  return apiRequest('/api/agents?pageSize=100');
}

export function listTasks(): Promise<PaginatedResponse<Task>> {
  return apiRequest('/api/tasks?pageSize=100');
}

export function listConversations(): Promise<ApiResponse<Conversation[]>> {
  return apiRequest('/api/conversations');
}

export function listMessages(
  conversationId: string,
  opts: ListMessagesOpts = {},
): Promise<CursorResponse<Message>> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set('cursor', opts.cursor);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.direction) params.set('direction', opts.direction);
  const qs = params.toString();
  return apiRequest(`/api/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`);
}

export function sendMessage(conversationId: string, body: string): Promise<ApiResponse<Message>> {
  return apiRequest(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: { body },
  });
}
