import type { FastifyInstance } from 'fastify';
import { AgentStatus } from '../../shared/constants.js';
import type {
  Agent,
  AgentDetail,
  CreateAgentInput,
  DeleteAgentResult,
} from '../../shared/types.js';
import { AgentRepository } from '../repositories/agent.repository.js';
import { ConversationRepository } from '../repositories/conversation.repository.js';
import { MessageRepository } from '../repositories/message.repository.js';
import { ProjectRepository } from '../repositories/project.repository.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { paginationQuery } from '../schemas/common.schema.js';
import { AgentService } from '../services/agent.service.js';
import { ConversationService } from '../services/conversation.service.js';

/**
 * Agent 라우트 — FR-007
 *
 * 정의 원본: DES-002 v2.1 §3-1 · §7-2 · DES-004 v2.2 §7~8·§13
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지).
 */

const AGENT_STATUS_VALUES = Object.values(AgentStatus);

interface ListQuery {
  page?: number;
  pageSize?: number;
  projectId?: string;
  status?: string;
}

interface IdParams {
  id: string;
}

interface StatusBody {
  status: string;
}

export function registerAgentRoutes(app: FastifyInstance): void {
  // AgentService → ConversationService는 "허용된 Service 간 의존 4건"이다
  // (src/CLAUDE.md §레이어 규칙: Stage → Approval → Agent → Conversation).
  const conversationService = new ConversationService(
    new ConversationRepository(app.db),
    new MessageRepository(app.db),
  );
  const service = new AgentService(
    app.db,
    new AgentRepository(app.db),
    new StatusChangeRepository(app.db),
    new ProjectRepository(app.db),
    new TaskRepository(app.db),
    conversationService,
    new ConversationRepository(app.db),
  );

  app.post<{ Body: CreateAgentInput }>(
    '/api/agents',
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['projectId', 'name'],
          additionalProperties: false,
          properties: {
            projectId: { type: 'string' },
            name: { type: 'string', minLength: 1, maxLength: 100 },
            type: { type: 'string' },
            skill: { type: 'string' },
            config: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request, reply): Promise<{ data: Agent }> => {
      const agent = await service.create(request.body);
      reply.code(201);
      return { data: agent };
    },
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/agents',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectId: { type: 'string' },
            status: { type: 'string', enum: AGENT_STATUS_VALUES },
            ...paginationQuery,
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, projectId, status } = request.query;
      const { items, pagination } = await service.list({
        page,
        pageSize,
        projectId,
        status: status as AgentStatus | undefined,
      });
      return { data: items, pagination };
    },
  );

  app.get<{ Params: IdParams }>(
    '/api/agents/:id',
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
    async (request): Promise<{ data: AgentDetail }> => {
      const agent = await service.getById(request.params.id);
      return { data: agent };
    },
  );

  app.patch<{ Params: IdParams; Body: StatusBody }>(
    '/api/agents/:id/status',
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
          required: ['status'],
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: AGENT_STATUS_VALUES },
          },
        },
      },
    },
    async (request): Promise<{ data: Agent }> => {
      const agent = await service.updateStatus(
        request.params.id,
        request.body.status as AgentStatus,
      );
      return { data: agent };
    },
  );

  app.delete<{ Params: IdParams }>(
    '/api/agents/:id',
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
    async (request): Promise<{ data: DeleteAgentResult }> => {
      const result = await service.delete(request.params.id);
      return { data: result };
    },
  );
}
