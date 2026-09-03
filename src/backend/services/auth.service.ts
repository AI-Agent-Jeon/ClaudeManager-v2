import { ErrorCode } from '../../shared/constants.js';
import type { LoginResponse } from '../../shared/types.js';
import { AppError } from '../utils/errors.js';

/**
 * 인증 비즈니스 로직
 *
 * 정의 원본: DES-004 v2.2 §2 · DES-001 v3.2 ADR-005
 */

/**
 * JWT 서명기. Fastify 인스턴스가 아니라 이 인터페이스에 의존한다 —
 * 구체 구현이 아닌 추상에 의존하라(DIP). 덕분에 서버를 띄우지 않고
 * 단위 테스트가 가능하다.
 */
export interface JwtSigner {
  sign(payload: object, opts: { expiresIn: string }): string;
  decode(token: string): { exp: number } | null;
}

export interface AuthConfig {
  authSecret: string;
  jwtExpiresIn: string;
}

export class AuthService {
  constructor(
    private readonly config: AuthConfig,
    private readonly jwt: JwtSigner,
  ) {}

  /**
   * 시크릿을 검증하고 토큰을 발급한다.
   *
   * 사용자 테이블이 없다 — 1인 사용자이므로 JWT에 사용자 정보를 넣지 않는다
   * (ADR-005). 페이로드가 비어 있어도 서명 자체가 인증의 증거다.
   */
  login(secret: string): LoginResponse {
    if (secret !== this.config.authSecret) {
      throw new AppError(401, ErrorCode.AUTH_INVALID_SECRET, '시크릿이 올바르지 않습니다');
    }

    const token = this.jwt.sign({}, { expiresIn: this.config.jwtExpiresIn });
    const decoded = this.jwt.decode(token);

    // 만료 시각을 추측하지 않는다. 토큰이 말하는 것과 응답이 말하는 것이
    // 어긋나면 CLI가 잘못된 시점에 재로그인을 안내한다.
    if (!decoded?.exp) {
      throw new AppError(500, ErrorCode.INTERNAL_ERROR, '토큰 만료 시각을 확인할 수 없습니다');
    }

    return {
      token,
      expiresAt: new Date(decoded.exp * 1000).toISOString(),
    };
  }
}
