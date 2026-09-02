import Fastify, { type FastifyInstance } from 'fastify';
import { ErrorCode } from '../shared/constants.js';
import { type AppConfig, loadConfig } from './config.js';
import { registerAuth } from './plugins/auth.js';
import { registerDatabase } from './plugins/database.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { registerProjectRoutes } from './routes/projects.routes.js';
import { registerStatusChangeRoutes } from './routes/status-changes.routes.js';
import { commonSchemas } from './schemas/common.schema.js';
import { AppError, toErrorResponse } from './utils/errors.js';
import { WebSocketHub } from './ws/hub.js';

declare module 'fastify' {
  interface FastifyInstance {
    hub: WebSocketHub;
    config: AppConfig;
  }
}

export interface BuildAppOptions {
  config?: Partial<AppConfig>;
  logger?: boolean;
}

/**
 * Fastify 앱 구성
 *
 * 정의 원본: DES-001 v3.2 §기동 순서 1~4단계
 *
 * 등록 순서가 곧 기동 순서다. DB → 인증 → 라우트 순으로 읽힌다.
 * `listen`은 여기서 하지 않는다 — 테스트는 `inject`로 포트 없이 돌린다.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config: AppConfig = { ...loadConfig(), ...options.config };

  const app = Fastify({
    logger: options.logger ?? false,
    // 잘못된 JSON은 라우트에 닿기 전에 400으로 떨어진다
    ajv: { customOptions: { removeAdditional: false, allErrors: false } },
  });

  app.decorate('config', config);
  app.addSchema(commonSchemas);

  // 2~3단계: DB 연결 + 마이그레이션. 실패하면 여기서 던져 기동을 멈춘다 (FR-001)
  registerDatabase(app, config.dbPath);

  // 4단계: 플러그인·라우트
  await registerAuth(app, config.authSecret);
  app.decorate('hub', new WebSocketHub());

  registerHealthRoutes(app, config.version);
  registerAuthRoutes(app, config);
  registerProjectRoutes(app);
  registerStatusChangeRoutes(app);

  // 에러 응답은 4필드 고정이다 (DES-009 §HTTP 에러 응답 형식)
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof AppError) {
      const body = toErrorResponse(err);
      return reply.code(body.statusCode).send(body);
    }

    // Fastify JSON Schema 검증 실패
    const fastifyErr = err as { validation?: unknown; message?: string };
    if (fastifyErr.validation) {
      const body = toErrorResponse(
        new AppError(
          400,
          ErrorCode.VALIDATION_ERROR,
          fastifyErr.message ?? '요청 형식이 올바르지 않습니다',
        ),
      );
      return reply.code(400).send(body);
    }

    request.log.error({ err }, 'unhandled error');
    const body = toErrorResponse(err);
    return reply.code(body.statusCode).send(body);
  });

  app.setNotFoundHandler((_request, reply) => {
    const body = toErrorResponse(
      new AppError(404, ErrorCode.NOT_FOUND, '요청한 경로를 찾을 수 없습니다'),
    );
    return reply.code(404).send(body);
  });

  // WS Hub는 소켓 정리를 DB 종료보다 먼저 해야 한다 (Graceful Shutdown 3단계).
  // onClose는 등록의 역순으로 실행되므로 DB보다 나중에 등록한다.
  app.addHook('onClose', async () => {
    app.hub.closeAll();
  });

  await app.ready();
  return app;
}
