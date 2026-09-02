import type { FastifyInstance } from 'fastify';
import type { PaginatedResponse, StatusChange } from '../../shared/types.js';
import { paginationQuery } from '../schemas/common.schema.js';

/**
 * GET /api/status-changes — FR-009 상태 변경 이력 조회
 *
 * 정의 원본: DES-002 v2.1 §3-1 · DES-004 v2.2 §12
 *
 * 정렬은 changed_at ASC(시간순)다. 이력은 "무슨 일이 순서대로 일어났는가"를
 * 보는 것이므로 최신순이 아니다.
 */

interface ListQuery {
  entityType?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

interface StatusChangeRow {
  id: number;
  entity_type: string;
  entity_id: string;
  from_status: string | null;
  to_status: string;
  changed_by: string;
  changed_at: string;
}

export function registerStatusChangeRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: ListQuery }>(
    '/api/status-changes',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            entityType: {
              type: 'string',
              enum: ['project', 'agent', 'task', 'conversation', 'approval', 'stage'],
            },
            entityId: { type: 'string' },
            ...paginationQuery,
          },
        },
      },
    },
    async (request): Promise<PaginatedResponse<StatusChange>> => {
      const { entityType, entityId } = request.query;
      const page = request.query.page ?? 1;
      const pageSize = request.query.pageSize ?? 20;

      const where: string[] = [];
      const params: unknown[] = [];
      if (entityType) {
        where.push('entity_type = ?');
        params.push(entityType);
      }
      if (entityId) {
        where.push('entity_id = ?');
        params.push(entityId);
      }
      const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

      const total = (
        app.db.prepare(`SELECT COUNT(*) AS n FROM status_changes ${clause}`).get(...params) as {
          n: number;
        }
      ).n;

      const rows = app.db
        .prepare(
          `SELECT * FROM status_changes ${clause} ORDER BY changed_at ASC, id ASC LIMIT ? OFFSET ?`,
        )
        .all(...params, pageSize, (page - 1) * pageSize) as StatusChangeRow[];

      return {
        data: rows.map((r) => ({
          id: r.id,
          entityType: r.entity_type as StatusChange['entityType'],
          entityId: r.entity_id,
          fromStatus: r.from_status,
          toStatus: r.to_status,
          changedBy: r.changed_by,
          changedAt: r.changed_at,
        })),
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      };
    },
  );
}
