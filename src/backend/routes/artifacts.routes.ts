import type { FastifyInstance } from 'fastify';
import { SyncStatus } from '../../shared/constants.js';
import type { Artifact } from '../../shared/types.js';
import { ArtifactRepository } from '../repositories/artifact.repository.js';
import { ArtifactService } from '../services/artifact.service.js';

/**
 * 산출물 라우트 — FR-031 (산출물 동기화 추적)
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5(GET /api/artifacts · GET /api/artifacts/:id/content)
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지) —
 * 아래 Repository 임포트는 DI 조립용이다.
 */

const SYNC_STATUS_VALUES = Object.values(SyncStatus);

interface ListQuery {
  stage?: string;
  syncStatus?: string;
}

interface IdParams {
  id: string;
}

/**
 * `ArtifactService`를 조립한다. `approvals.routes.ts`의 `buildApprovalService`가
 * `ArtifactRepository`를 직접 주입받을 때(§3 스텁 교체) 재사용할 수 있도록
 * export한다.
 */
export function buildArtifactService(app: FastifyInstance): ArtifactService {
  return new ArtifactService(new ArtifactRepository(app.db));
}

export function registerArtifactRoutes(app: FastifyInstance): void {
  const service = buildArtifactService(app);

  app.get<{ Querystring: ListQuery }>(
    '/api/artifacts',
    {
      onRequest: [app.authenticate],
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stage: { type: 'string', format: 'uuid' },
            syncStatus: { type: 'string', enum: SYNC_STATUS_VALUES },
          },
        },
      },
    },
    async (request): Promise<{ data: Artifact[] }> => {
      const { stage, syncStatus } = request.query;
      const data = await service.list({
        stage,
        syncStatus: syncStatus as Artifact['syncStatus'] | undefined,
      });
      return { data };
    },
  );

  app.get<{ Params: IdParams }>(
    '/api/artifacts/:id/content',
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
    async (request): Promise<{ data: { content: string } }> => {
      const content = await service.getContent(request.params.id);
      return { data: { content } };
    },
  );
}
