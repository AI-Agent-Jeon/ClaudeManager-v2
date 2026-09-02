import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLI_CONFIG_DIR, CLI_CONFIG_FILE } from '../shared/constants.js';

/**
 * CLI 설정 — 토큰 저장/로드
 *
 * 정의 원본: DES-008 v3.1 §CLI Config · DES-009 v3.1 §CLI 상수
 * (CLI_CONFIG_DIR·CLI_CONFIG_FILE)
 *
 * 저장 위치: `~/.claude-manager/config.json` (등급 '낮음' — 자율 판단).
 * 근거: 리포지토리 밖(홈 디렉토리)에 두어야 `git status`에 걸리지 않고,
 * 여러 프로젝트 체크아웃 간에도 로그인 상태가 유지된다.
 *
 * **토큰을 로그·에러 메시지에 절대 찍지 않는다** — 이 파일의 함수들은 파일 I/O만
 * 하고 console에 값을 쓰지 않는다. 호출부(commands/auth.ts)도 토큰 원문을
 * 화면에 출력하지 않고 저장 경로·만료일시만 보여준다 (DES-006 §3 SCR-A01·A02).
 */

export interface StoredAuth {
  token: string;
  /** ISO 8601 */
  expiresAt: string;
}

export function getConfigDir(homeDir: string = homedir()): string {
  return join(homeDir, CLI_CONFIG_DIR);
}

export function getConfigPath(homeDir: string = homedir()): string {
  return join(getConfigDir(homeDir), CLI_CONFIG_FILE);
}

/**
 * 토큰을 저장한다.
 *
 * 파일 모드 `0o600`(소유자만 읽기/쓰기)으로 생성한다. Windows는 POSIX 모드
 * 비트를 적용하지 않으므로 이 인자는 거기서 조용히 무시된다 — 별도 ACL 처리는
 * Phase 1 범위 밖으로 둔다(등급 낮음).
 */
export function saveAuth(auth: StoredAuth, homeDir: string = homedir()): void {
  const dir = getConfigDir(homeDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(getConfigPath(homeDir), JSON.stringify(auth, null, 2), { mode: 0o600 });
}

/**
 * 토큰을 로드한다. 파일이 없거나, 손상됐거나, 필드가 빠졌으면 `null`을
 * 돌려준다 — 예외를 던지지 않는다. 손상된 로컬 상태는 "미인증"과 동일하게
 * 취급해 재로그인으로 자연스럽게 복구시킨다.
 */
export function loadAuth(homeDir: string = homedir()): StoredAuth | null {
  let text: string;
  try {
    text = readFileSync(getConfigPath(homeDir), 'utf-8');
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as Partial<StoredAuth>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'string') {
      return null;
    }
    return { token: parsed.token, expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

/** 파일이 없어도 에러를 던지지 않는다 (멱등) */
export function clearAuth(homeDir: string = homedir()): void {
  rmSync(getConfigPath(homeDir), { force: true });
}
