import type { FastifyInstance } from 'fastify';
import type { LoginRequest, LoginResponse } from '../../shared/types.js';
import { AuthService } from '../services/auth.service.js';

/**
 * POST /api/auth/login — FR-002
 *
 * 정의 원본: DES-002 v2.1 §3-1 · DES-004 v2.2 §2
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  config: { authSecret: string; jwtExpiresIn: string },
): void {
  const service = new AuthService(config, {
    sign: (payload, opts) => app.jwt.sign(payload, opts),
    decode: (token) => app.jwt.decode<{ exp: number }>(token),
  });

  app.post<{ Body: LoginRequest }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['secret'],
          // 정의되지 않은 필드를 막는다. 없으면 클라이언트가 role 같은 값을
          // 실어 보내 서버가 무시하는지 반영하는지 알 수 없게 된다.
          additionalProperties: false,
          properties: {
            secret: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request): Promise<{ data: LoginResponse }> => {
      return { data: service.login(request.body.secret) };
    },
  );
}
