import type { FastifyInstance } from 'fastify';
import { EntityType } from '../../shared/constants.js';
import type { PaginatedResponse, StatusChange } from '../../shared/types.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { paginationQuery } from '../schemas/common.schema.js';
import { StatusChangeService } from '../services/status-change.service.js';

/**
 * GET /api/status-changes — FR-009 상태 변경 이력 조회
 *
 * 정의 원본: DES-002 v2.1 §3-1 · DES-004 v2.2 §12
 *
 * 정렬은 changed_at ASC(시간순)다. 이력은 "무슨 일이 순서대로 일어났는가"를
 * 보는 것이므로 최신순이 아니다.
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 — DB를 직접 쿼리하지 않는다.
 */

const ENTITY_TYPE_VALUES = Object.values(EntityType);

interface ListQuery {
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

export function registerStatusChangeRoutes(app: FastifyInstance): void {
  const service = new StatusChangeService(new StatusChangeRepository(app.db));

  app.get<{ Querystring: ListQuery }>(
    '/api/status-changes',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entityType: { type: 'string', enum: ENTITY_TYPE_VALUES },
            entityId: { type: 'string' },
            ...paginationQuery,
          },
        },
      },
    },
    async (request): Promise<PaginatedResponse<StatusChange>> => {
      const { page = 1, pageSize = 20, entityType, entityId } = request.query;
      const { items, pagination } = await service.list({
        page,
        pageSize,
        entityType: entityType as StatusChange['entityType'] | undefined,
        entityId,
      });

      return { data: items, pagination };
    },
  );
}
