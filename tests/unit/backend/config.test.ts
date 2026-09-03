import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isLoopbackHost, loadConfig } from '../../../src/backend/config.js';

/**
 * 정의 원본: DES-009 v3.1 §상수 · DES-001 v3.2 ADR-005
 */

const KEYS = ['CM_HOST', 'CM_PORT', 'CM_DB_PATH', 'CM_AUTH_SECRET', 'CM_JWT_EXPIRES'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('loadConfig — DES-009 §상수', () => {
  it('환경 변수가 없으면 설계서 기본값을 쓴다', () => {
    const c = loadConfig();
    expect(c.host).toBe('127.0.0.1');
    expect(c.port).toBe(3000);
    expect(c.dbPath).toBe('./data/claude-manager.db');
    expect(c.jwtExpiresIn).toBe('7d');
  });

  it('환경 변수가 있으면 그것을 쓴다', () => {
    process.env.CM_HOST = '0.0.0.0';
    process.env.CM_PORT = '4100';
    process.env.CM_DB_PATH = ':memory:';
    process.env.CM_JWT_EXPIRES = '1h';

    const c = loadConfig();
    expect(c.host).toBe('0.0.0.0');
    expect(c.port).toBe(4100);
    expect(c.dbPath).toBe(':memory:');
    expect(c.jwtExpiresIn).toBe('1h');
  });

  it('포트가 숫자가 아니면 던진다 — 조용히 기본값으로 떨어지지 않는다', () => {
    process.env.CM_PORT = '삼천';
    expect(() => loadConfig()).toThrow(/CM_PORT/);
  });

  it('포트 범위를 벗어나면 던진다', () => {
    process.env.CM_PORT = '70000';
    expect(() => loadConfig()).toThrow(/CM_PORT/);
  });

  it(
    'SEC-06/SEC-10 — CM_HOST가 빈 문자열이면 미설정으로 취급해 127.0.0.1로 되돌린다 ' +
      '(??는 빈 문자열을 통과시켜 Node가 "모든 인터페이스"로 해석하는 문제)',
    () => {
      process.env.CM_HOST = '';
      const c = loadConfig();
      expect(c.host).toBe('127.0.0.1');
    },
  );

  it('REV-L-02 — CM_DB_PATH가 빈 문자열이면 미설정으로 취급해 기본 경로로 되돌린다', () => {
    process.env.CM_DB_PATH = '';
    const c = loadConfig();
    expect(c.dbPath).toBe('./data/claude-manager.db');
  });

  it('버전은 process.env가 아니라 주입받은 env를 쓴다 (SEC-06 증상 5-c)', () => {
    const c = loadConfig({ npm_package_version: '9.9.9' });
    expect(c.version).toBe('9.9.9');
  });
});

describe('isLoopbackHost — Phase 1 접속 경계(DES-001) 경고 판정', () => {
  it('127.0.0.1·localhost·::1은 루프백이다', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('0.0.0.0이나 그 외 호스트는 루프백이 아니다', () => {
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.0.10')).toBe(false);
  });
});

describe('인증 시크릿 — ADR-005', () => {
  it('미설정이면 랜덤 생성하고 생성 사실을 알린다', () => {
    const c = loadConfig();
    expect(c.authSecret).toHaveLength(64);
    // 최초 실행에서 콘솔에 출력해야 하므로 호출부가 알 수 있어야 한다
    expect(c.authSecretGenerated).toBe(true);
  });

  it('호출마다 다른 값을 만든다', () => {
    expect(loadConfig().authSecret).not.toBe(loadConfig().authSecret);
  });

  it('설정되어 있으면 그것을 쓰고 생성하지 않는다', () => {
    process.env.CM_AUTH_SECRET = 'my-secret';
    const c = loadConfig();
    expect(c.authSecret).toBe('my-secret');
    expect(c.authSecretGenerated).toBe(false);
  });

  it(
    'SEC-06 증상 5-b — CM_AUTH_SECRET이 빈 문자열이면 미설정으로 취급해 랜덤 생성한다 ' +
      '(authSecretGenerated=true인데 authSecret이 빈 값으로 남는 불일치를 막는다)',
    () => {
      process.env.CM_AUTH_SECRET = '';
      const c = loadConfig();
      expect(c.authSecretGenerated).toBe(true);
      expect(c.authSecret).toHaveLength(64);
      expect(c.authSecret).not.toBe('');
    },
  );
});
