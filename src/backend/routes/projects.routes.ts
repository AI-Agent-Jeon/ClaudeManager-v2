import type { FastifyInstance } from 'fastify';
import { ProjectStatus } from '../../shared/constants.js';
import type { CreateProjectInput, Project, ProjectDetail } from '../../shared/types.js';
import { ProjectRepository } from '../repositories/project.repository.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { paginationQuery } from '../schemas/common.schema.js';
import { ProjectService } from '../services/project.service.js';

/**
 * Project 라우트 — FR-003 ~ FR-006
 *
 * 정의 원본: DES-002 v2.1 §3-1 · §7-2 · DES-004 v2.2 §3~6
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지).
 */

const PROJECT_STATUS_VALUES = Object.values(ProjectStatus);

interface ListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
}

interface StatusParams {
  id: string;
}

interface StatusBody {
  status: string;
}

export function registerProjectRoutes(app: FastifyInstance): void {
  const service = new ProjectService(
    new ProjectRepository(app.db),
    new StatusChangeRepository(app.db),
  );

  app.post<{ Body: CreateProjectInput }>(
    '/api/projects',
    {
      onRequest: [app.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string' },
          },
        },
      },
    },
    async (request, reply): Promise<{ data: Project }> => {
      const project = await service.create(request.body);
      reply.code(201);
      return { data: project };
    },
  );

  app.get<{ Querystring: ListQuery }>(
    '/api/projects',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', enum: PROJECT_STATUS_VALUES },
            ...paginationQuery,
          },
        },
      },
    },
    async (request) => {
      const { page = 1, pageSize = 20, status } = request.query;
      const { items, pagination } = await service.list({
        page,
        pageSize,
        status: status as ProjectStatus | undefined,
      });
      return { data: items, pagination };
    },
  );

  app.get<{ Params: StatusParams }>(
    '/api/projects/:id',
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
    async (request): Promise<{ data: ProjectDetail }> => {
      const project = await service.getById(request.params.id);
      return { data: project };
    },
  );

  app.patch<{ Params: StatusParams; Body: StatusBody }>(
    '/api/projects/:id/status',
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
            status: { type: 'string', enum: PROJECT_STATUS_VALUES },
          },
        },
      },
    },
    async (request): Promise<{ data: Project }> => {
      const project = await service.updateStatus(
        request.params.id,
        request.body.status as ProjectStatus,
      );
      return { data: project };
    },
  );
}
