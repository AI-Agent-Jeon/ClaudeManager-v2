import type { FastifyInstance } from 'fastify';
import { ChannelType, ConversationStatus } from '../../shared/constants.js';
import type {
  Conversation,
  CursorResponse,
  Message,
  SearchResult,
  SendMessageInput,
} from '../../shared/types.js';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { ConversationService } from '../services/conversation.service.js';

/**
 * 대화 라우트 — FR-026 · FR-027 (REST 5종. `WS /ws/conversations/:id`는 다음 위임 범위다)
 *
 * 정의 원본: DES-002 v2.2 §3-2 · §4 · DES-004 v2.2 §14 · §전체 함수 시그니처 요약
 *
 * 레이어 규칙 2(src/CLAUDE.md): Routes는 Service만 호출한다 (Repository 직접 접근 금지).
 * `:id`는 UUID 전용이다 — `main` 별칭 경로는 만들지 않는다(DES-002 §4).
 * CH-MAIN은 `GET /api/conversations?type=main`으로 id를 먼저 얻는다.
 */

const CHANNEL_TYPE_VALUES = Object.values(ChannelType);
const CONVERSATION_STATUS_VALUES = Object.values(ConversationStatus);

interface ListQuery {
  type?: string;
  status?: string;
  project?: string;
  from?: string;
  to?: string;
}

interface IdParams {
  id: string;
}

interface MessagesQuery {
  cursor?: string;
  limit?: number;
  direction?: 'before' | 'after';
}

interface SendMessageBody {
  body: string;
}

interface SearchQuery {
  q: string;
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function registerConversationRoutes(app: FastifyInstance): void {
  const service = new ConversationService(
    new ConversationRepository(app.db),
    new MessageRepository(app.db),
  );

  // GET /api/conversations/search — 세그먼트 개수가 달라 GET /:id/* 계열과 라우팅이
  // 충돌하지 않는다(find-my-way는 정적 경로를 파라미터 경로보다 우선한다).
  app.get<{ Querystring: SearchQuery }>(
    '/api/conversations/search',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          required: ['q'],
          additionalProperties: false,
          properties: {
            q: { type: 'string', minLength: 2 },
            type: { type: 'string', enum: CHANNEL_TYPE_VALUES },
            status: { type: 'string', enum: CONVERSATION_STATUS_VALUES },
            from: { type: 'string' },
            to: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
      },
    },
    async (request): Promise<{ data: SearchResult[] }> => {
      const { q, type, status, from, to, limit } = request.query;
      const data = await service.search({
        q,
        type: type as ChannelType | undefined,
        status: status as ConversationStatus | undefined,
        from,
        to,
        limit,
      });
      return { data };
    },
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/conversations',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            type: { type: 'string', enum: CHANNEL_TYPE_VALUES },
            status: { type: 'string', enum: CONVERSATION_STATUS_VALUES },
            project: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
      },
    },
    async (request): Promise<{ data: Conversation[] }> => {
      const { type, status, project, from, to } = request.query;
      const data = await service.list({
        type: type as ChannelType | undefined,
        status: status as ConversationStatus | undefined,
        project,
        from,
        to,
      });
      return { data };
    },
  );

  app.get<{ Params: IdParams; Querystring: MessagesQuery }>(
    '/api/conversations/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cursor: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            direction: { type: 'string', enum: ['before', 'after'], default: 'before' },
          },
        },
      },
    },
    async (request): Promise<CursorResponse<Message>> => {
      const { cursor, limit, direction } = request.query;
      return service.listMessages(request.params.id, { cursor, limit, direction });
    },
  );

  app.post<{ Params: IdParams; Body: SendMessageBody }>(
    '/api/conversations/:id/messages',
    {
      onRequest: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['body'],
          // msgType·senderRole 주입 차단 — 없으면 클라이언트가 senderRole:"agent"를
          // 실어 대표 발화를 Agent 보고로 위장할 수 있다 (DES-002 §6-3).
          additionalProperties: false,
          properties: {
            body: { type: 'string', minLength: 1, maxLength: 10000 },
          },
        },
      },
    },
    async (request, reply): Promise<{ data: Message }> => {
      const input: SendMessageInput = { body: request.body.body };
      const message = await service.sendMessage(request.params.id, input);
      reply.code(201);
      return { data: message };
    },
  );

  app.get<{ Params: IdParams }>(
    '/api/conversations/:id/export',
    {
      onRequest: [app.authenticate],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          additionalProperties: false,
          properties: { id: { type: 'string' } },
        },
      },
    },
    async (request, reply): Promise<string> => {
      const markdown = await service.exportMarkdown(request.params.id);
      // 유일하게 응답 봉투({data:...})를 쓰지 않는 엔드포인트다 (DES-002 §4)
      reply
        .header('content-type', 'text/markdown; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="conversation-${request.params.id}.md"`,
        );
      return markdown;
    },
  );
}
