import { describe, expect, it } from 'vitest';
import { AuthService, type JwtSigner } from '../../../../src/backend/services/auth.service.js';
import { AppError } from '../../../../src/backend/utils/errors.js';

/**
 * FR-002 토큰 기반 인증 — 수용 기준
 *   Given 올바른 인증 정보 When 로그인 When Then 인증 토큰이 발급된다
 *   Given 잘못된 인증 정보 When 로그인 Then 401 에러가 반환된다
 *
 * 정의 원본: DES-004 v2.2 §2 · DES-001 v3.2 ADR-005
 */

/** 서명기를 주입한다 — Fastify 인스턴스 없이 단위 테스트가 가능해진다 */
function fakeSigner(exp = Math.floor(Date.now() / 1000) + 604800): JwtSigner {
  return {
    sign: () => 'signed.jwt.token',
    decode: () => ({ exp }),
  };
}

const config = { authSecret: 'correct-secret', jwtExpiresIn: '7d' };

describe('AuthService.login — FR-002', () => {
  it('Given 올바른 시크릿 When 로그인 Then 토큰이 발급된다', () => {
    const svc = new AuthService(config, fakeSigner());
    const res = svc.login('correct-secret');

    expect(res.token).toBe('signed.jwt.token');
    expect(res.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('Given 잘못된 시크릿 When 로그인 Then 401 AUTH_INVALID_SECRET', () => {
    const svc = new AuthService(config, fakeSigner());

    expect(() => svc.login('wrong')).toThrow(AppError);
    try {
      svc.login('wrong');
    } catch (e) {
      expect((e as AppError).statusCode).toBe(401);
      expect((e as AppError).code).toBe('AUTH_INVALID_SECRET');
    }
  });

  it('빈 시크릿도 거부한다', () => {
    const svc = new AuthService(config, fakeSigner());
    expect(() => svc.login('')).toThrow(AppError);
  });

  it('만료 시각을 ISO 8601로 돌려준다', () => {
    const exp = Math.floor(new Date('2026-09-09T00:00:00.000Z').getTime() / 1000);
    const svc = new AuthService(config, fakeSigner(exp));

    expect(svc.login('correct-secret').expiresAt).toBe('2026-09-09T00:00:00.000Z');
  });

  it('decode가 실패하면 던진다 — 만료 시각을 추측하지 않는다', () => {
    const broken: JwtSigner = { sign: () => 't', decode: () => null };
    const svc = new AuthService(config, broken);

    expect(() => svc.login('correct-secret')).toThrow(AppError);
  });
});
