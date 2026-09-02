import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearAuth,
  getConfigDir,
  getConfigPath,
  loadAuth,
  saveAuth,
} from '../../../src/cli/config.js';

/**
 * CLI 설정 — 토큰 저장/로드/삭제
 *
 * 정의 원본: DES-008 v3.1 §CLI Config
 * 실제 홈 디렉토리를 건드리지 않도록 매 테스트마다 임시 디렉토리를 홈으로
 * 주입한다 (모든 함수가 `homeDir`을 옵션으로 받는다).
 */

let homeDir: string;

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'cm-cli-config-test-'));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe('getConfigDir · getConfigPath', () => {
  it('~/.claude-manager/config.json 형태다', () => {
    expect(getConfigDir(homeDir)).toBe(join(homeDir, '.claude-manager'));
    expect(getConfigPath(homeDir)).toBe(join(homeDir, '.claude-manager', 'config.json'));
  });
});

describe('loadAuth', () => {
  it('파일이 없으면 null을 돌려준다', () => {
    expect(loadAuth(homeDir)).toBeNull();
  });

  it('손상된 JSON이면 null을 돌려준다 — 예외를 던지지 않는다', () => {
    saveAuth({ token: 't', expiresAt: '2026-09-09T00:00:00.000Z' }, homeDir);
    writeFileSync(getConfigPath(homeDir), '{ not json', 'utf-8');

    expect(loadAuth(homeDir)).toBeNull();
  });

  it('필드가 빠져 있으면 null을 돌려준다', () => {
    mkdirSync(getConfigDir(homeDir), { recursive: true });
    writeFileSync(getConfigPath(homeDir), JSON.stringify({ token: 't' }), 'utf-8');
    expect(loadAuth(homeDir)).toBeNull();
  });
});

describe('saveAuth · loadAuth 왕복', () => {
  it('저장한 값을 그대로 읽는다', () => {
    saveAuth({ token: 'jwt-token-value', expiresAt: '2026-09-09T00:00:00.000Z' }, homeDir);

    const loaded = loadAuth(homeDir);
    expect(loaded).toEqual({ token: 'jwt-token-value', expiresAt: '2026-09-09T00:00:00.000Z' });
  });

  it('디렉토리가 없어도 재귀 생성한다', () => {
    expect(existsSync(getConfigDir(homeDir))).toBe(false);
    saveAuth({ token: 't', expiresAt: '2026-09-09T00:00:00.000Z' }, homeDir);
    expect(existsSync(getConfigDir(homeDir))).toBe(true);
  });

  // POSIX에서만 파일 모드 비트가 의미를 갖는다 — Windows는 0o600을 무시한다
  it.skipIf(process.platform === 'win32')('파일을 소유자 전용(0o600)으로 생성한다', () => {
    saveAuth({ token: 't', expiresAt: '2026-09-09T00:00:00.000Z' }, homeDir);
    const mode = statSync(getConfigPath(homeDir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('clearAuth', () => {
  it('저장된 토큰을 삭제한다', () => {
    saveAuth({ token: 't', expiresAt: '2026-09-09T00:00:00.000Z' }, homeDir);
    clearAuth(homeDir);

    expect(loadAuth(homeDir)).toBeNull();
    expect(existsSync(getConfigPath(homeDir))).toBe(false);
  });

  it('파일이 없어도 예외를 던지지 않는다', () => {
    expect(() => clearAuth(homeDir)).not.toThrow();
  });
});
