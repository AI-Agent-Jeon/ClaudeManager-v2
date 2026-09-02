import type { FastifyInstance } from 'fastify';
import type { StageSummary } from '../../shared/types.js';
import { PhaseRepository } from '../repositories/phase.repository.js';
import { StatusChangeRepository } from '../repositories/status-change.repository.js';
import { StageService } from '../services/stage.service.js';
import { buildApprovalService } from './approvals.routes.js';

/**
 * 단계(Stage) 라우트 — FR-030
 *
 * 정의 원본: DES-002 v2.1 §3-3 · §5 `POST /api/stages/:id/start` ·
 * DES-004 v2.4 §16 · DES-007 v2.1 §7-1
 *
 * **CLAUDE.md 스킬 전환 게이트의 유일한 강제 지점이다.** `complete()`에
 * 대응하는 HTTP 엔드포인트는 DES-002 엔드포인트 목록(§3-3)에 없다 — 서비스
 * 메서드로만 존재하고 라우트는 열지 않는다(개발 지시 §1 신규 범위 참조).
 *
 * 레이어 규칙 2: Routes는 Service만 호출한다 (Repository 직접 접근 금지) —
 * 아래 Repository 임포트는 DI 조립용이다.
 */

interface IdParams {
  id: string;
}

/**
 * `StageService`를 조립한다. `StageService → ApprovalService`는 "허용된
 * Service 간 의존 4건" 중 하나다(DES-001 v3.2). `approvals.routes.ts`가
 * export하는 `buildApprovalService`를 그대로 재사용한다 — `agents.routes.ts`가
 * 이미 같은 패턴을 쓴다(별도 인스턴스를 조립해 쓰되 빌더 함수는 공유).
 */
export function buildStageService(app: FastifyInstance): StageService {
  return new StageService(
    app.db,
    new PhaseRepository(app.db),
    buildApprovalService(app),
    new StatusChangeRepository(app.db),
    app.hub,
  );
}

export function registerStageRoutes(app: FastifyInstance): void {
  const service = buildStageService(app);

  app.post<{ Params: IdParams }>(
    '/api/stages/:id/start',
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
    async (request): Promise<{ data: StageSummary }> => {
      const data = await service.start(request.params.id);
      return { data };
    },
  );
}
