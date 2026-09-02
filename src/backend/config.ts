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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const envSecret = env.CM_AUTH_SECRET;
  const authSecretGenerated = !envSecret;

  return {
    host: env.CM_HOST ?? DEFAULT_HOST,
    port: readPort(env.CM_PORT),
    dbPath: env.CM_DB_PATH ?? DB_FILE_PATH,
    // 시크릿 미설정 시 랜덤 생성 후 콘솔 출력 (ADR-005).
    // 매 기동마다 값이 바뀌므로 발급된 토큰이 무효가 된다 — 그래서 알려야 한다.
    authSecret: envSecret ?? randomBytes(32).toString('hex'),
    jwtExpiresIn: env.CM_JWT_EXPIRES ?? JWT_EXPIRES_IN,
    authSecretGenerated,
    version: process.env.npm_package_version ?? '0.1.0',
  };
}
