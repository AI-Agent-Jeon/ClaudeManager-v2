import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '../../shared/types.js';

/**
 * GET /api/health — FR-001
 *
 * 인증이 필요 없는 유일한 GET이다 (DES-002 v2.1 §2-2).
 * CLI가 "서버가 떠 있는가"를 로그인 전에 확인해야 하기 때문이다.
 */
export function registerHealthRoutes(app: FastifyInstance, version: string): void {
  app.get('/api/health', async (): Promise<{ data: HealthResponse }> => {
    let database: HealthResponse['database'] = 'disconnected';
    try {
      app.db.prepare('SELECT 1').get();
      database = 'connected';
    } catch {
      // 헬스체크는 실패를 응답으로 알린다. 던지면 500이 되어
      // "서버는 떴는데 DB만 죽었다"는 상태를 구분할 수 없다.
    }

    return {
      data: {
        status: 'ok',
        version,
        uptime: Math.floor(process.uptime()),
        database,
      },
    };
  });
}
