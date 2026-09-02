import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../../src/backend/config.js';

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
});
