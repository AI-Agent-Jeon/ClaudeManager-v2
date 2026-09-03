import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIGRATION_FILES, runMigrateCli } from '../../../../src/backend/db/migrate.js';

/**
 * `npm run db:migrate` CLI 진입점 — NEW-01
 *
 * 정의 원본: test 스킬 9단계 결함 지시 NEW-01. 결함: `runMigrations()`가
 * export만 되고 실행 진입점이 없어 `db:migrate`가 no-op이었다.
 *
 * `runMigrateCli()`는 서버 기동 경로(`plugins/database.ts`)와 동일한
 * `openDatabase()`·`runMigrations()`를 재사용한다 — 여기서는 그 재사용
 * 위에 얹은 CLI 출력(적용/건너뜀/최종 버전)과 실패 시 예외 전파만 검증한다.
 * DB 스키마 자체(테이블·CHECK 제약)는 `migrations.test.ts`가 이미 검증한다.
 */

const KEYS = ['CM_DB_PATH'] as const;
let saved: Record<string, string | undefined> = {};
let tmpDir: string;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  tmpDir = mkdtempSync(join(tmpdir(), 'cm-migrate-cli-'));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('runMigrateCli', () => {
  it('빈 DB에 7개 마이그레이션을 전부 적용하고 사람이 읽을 결과를 출력한다', () => {
    process.env.CM_DB_PATH = join(tmpDir, 'test.db');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    runMigrateCli();

    const out = info.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain(`적용됨 (${MIGRATION_FILES.length}개)`);
    for (const name of MIGRATION_FILES) {
      expect(out).toContain(name);
    }
    expect(out).toContain(`최종 버전: ${MIGRATION_FILES[MIGRATION_FILES.length - 1]}`);
    expect(out).not.toContain('건너뜀');

    info.mockRestore();
  });

  it('멱등하다 — 같은 DB에 두 번째 실행하면 전부 건너뛴다', () => {
    process.env.CM_DB_PATH = join(tmpDir, 'test.db');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    runMigrateCli();
    info.mockClear();
    runMigrateCli();

    const out = info.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('적용됨: 없음');
    expect(out).toContain(`건너뜀 — 이미 적용됨 (${MIGRATION_FILES.length}개)`);

    info.mockRestore();
  });

  it('실패하면 예외를 그대로 던진다 — 배포 스크립트가 종료 코드로 실패를 감지해야 한다 (NEW-01)', () => {
    // 디렉토리를 DB 파일 경로로 지정해 openDatabase()가 실패하게 만든다.
    process.env.CM_DB_PATH = tmpDir;
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    expect(() => runMigrateCli()).toThrow();

    info.mockRestore();
  });
});
