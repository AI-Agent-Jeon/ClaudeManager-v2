import type { FastifyInstance } from 'fastify';
import { TaskStatus } from '../../shared/constants.js';
import type { CreateTaskInput, Task } from '../../shared/types.js';
import { AgentRepository } from '../repositories/agent.repository.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { TaskRepository } from '../repositories/task.repository.js';
import { paginationQuery } from '../schemas/common.schema.js';
import { TaskService } from '../services/task.service.js';

/**
 * Task 라우트 — FR-008
 *
 * 정의 원본: DES-002 v2.1 §3-1 · §7-2 · DES-004 v2.2 §9~11
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지).
 */

const TASK_STATUS_VALUES = Object.values(TaskStatus);

interface ListQuery {
  page?: number;
  pageSize?: number;
  agentId?: string;
  status?: string;
}

interface IdParams {
  id: string;
}

interface StatusBody {
  status: string;
}

export function registerTaskRoutes(app: FastifyInstance): void {
  const service = new TaskService(
    new TaskRepository(app.db),
    new StatusChangeRepository(app.db),
    new AgentRepository(app.db),
  );

  app.post<{ Body: CreateTaskInput }>(
    '/api/tasks',
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['agentId', 'title'],
          additionalProperties: false,
          properties: {
            agentId: { type: 'string' },
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string' },
          },
        },
      },
    },
    async (request, reply): Promise<{ data: Task }> => {
      const task = await service.create(request.body);
      reply.code(201);
      return { data: task };
    },
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/tasks',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            agentId: { type: 'string' },
            status: { type: 'string', enum: TASK_STATUS_VALUES },
            ...paginationQuery,
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, agentId, status } = request.query;
      const { items, pagination } = await service.list({
        page,
        pageSize,
        agentId,
        status: status as TaskStatus | undefined,
      });
      return { data: items, pagination };
    },
  );

  app.get<{ Params: IdParams }>(
    '/api/tasks/:id',
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
    async (request): Promise<{ data: Task }> => {
      const task = await service.getById(request.params.id);
      return { data: task };
    },
  );

  app.patch<{ Params: IdParams; Body: StatusBody }>(
    '/api/tasks/:id/status',
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
            status: { type: 'string', enum: TASK_STATUS_VALUES },
          },
        },
      },
    },
    async (request): Promise<{ data: Task }> => {
      const task = await service.updateStatus(request.params.id, request.body.status as TaskStatus);
      return { data: task };
    },
  );
}
