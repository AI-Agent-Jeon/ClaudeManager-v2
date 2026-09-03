import { randomBytes } from 'node:crypto';
import { DB_FILE_PATH, DEFAULT_HOST, DEFAULT_PORT, JWT_EXPIRES_IN } from '../shared/constants.js';

/**
 * 서버 설정 — 환경 변수 로드
 *
 * 정의 원본: DES-009 v3.1 §상수 · DES-001 v3.2 ADR-005
 */

export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  authSecret: string;
  jwtExpiresIn: string;
  /** 이번 기동에서 시크릿을 생성했는가 — true면 콘솔에 출력해야 한다 */
  authSecretGenerated: boolean;
  version: string;
}

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;

  const port = Number(raw);
  // 잘못된 값을 조용히 기본값으로 떨어뜨리지 않는다. 대표가 4100을 의도했는데
  // 3000에서 뜨면 "왜 안 되지"를 한참 찾게 된다.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`CM_PORT가 올바른 포트 번호가 아닙니다: ${raw}`);
  }
  return port;
}

/**
 * SEC-06/SEC-10/REV-L-02 — `??`는 `null`/`undefined`에만 반응해 빈 문자열을
 * 그대로 통과시킨다. `CM_HOST=''`가 `app.listen({ host: '' })`로 이어지면
 * Node는 이를 "모든 인터페이스"로 해석해 DES-001 §접속 경계("Phase 1 =
 * 127.0.0.1 전용, 외부 노출 없음")를 깬다. `readPort`와 같은 방식으로 빈
 * 문자열을 미설정으로 취급해 기본값으로 되돌린다.
 */
function readOrDefault(raw: string | undefined, fallback: string): string {
  return raw === undefined || raw === '' ? fallback : raw;
}

/** Phase 1 접속 경계(DES-001) 판정 — 루프백이 아니면 기동 배너에서 경고한다(거부는 하지 않는다) */
export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const envSecret = env.CM_AUTH_SECRET;
  // `''`도 "미설정"으로 취급한다(falsy) — 아래 `authSecret` 대체값 계산과
  // 반드시 같은 판정 기준을 써야 한다(SEC-06 증상 5-b: 기준이 어긋나면
  // "시크릿을 생성했습니다" 배너와 실제 빈 값이 따로 논다).
  const authSecretGenerated = !envSecret;

  return {
    host: readOrDefault(env.CM_HOST, DEFAULT_HOST),
    port: readPort(env.CM_PORT),
    dbPath: readOrDefault(env.CM_DB_PATH, DB_FILE_PATH),
    // 시크릿 미설정(빈 문자열 포함) 시 랜덤 생성 후 콘솔 출력 (ADR-005).
    // 매 기동마다 값이 바뀌므로 발급된 토큰이 무효가 된다 — 그래서 알려야 한다.
    // `||`를 쓴다 — `??`는 `''`를 유효한 시크릿으로 통과시켜 authSecretGenerated
    // (위)와 어긋난다(SEC-06 증상 5-b).
    authSecret: envSecret || randomBytes(32).toString('hex'),
    jwtExpiresIn: env.CM_JWT_EXPIRES ?? JWT_EXPIRES_IN,
    authSecretGenerated,
    // SEC-06 증상 5-c — 이 함수의 다른 5줄은 전부 주입받은 `env`를 쓰는데
    // 이 줄만 전역 `process.env`를 봤다. 테스트가 `env`를 주입해도 반영되지
    // 않는 버그였다.
    version: env.npm_package_version ?? '0.1.0',
  };
}
