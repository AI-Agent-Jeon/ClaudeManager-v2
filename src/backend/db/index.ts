import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { DB_FILE_PATH } from '../../shared/constants.js';

/**
 * SQLite 연결
 *
 * 정의 원본: DES-001 v3.2 §기동 순서 2단계 · DES-003 v2.1 §6 외래 키 정책
 */

export interface OpenDbOptions {
  /** 기본값은 DES-009 §상수의 DB_FILE_PATH. ':memory:'면 인메모리 */
  path?: string;
  readonly?: boolean;
}

/**
 * 연결을 열고 PRAGMA를 적용한다.
 *
 * **`foreign_keys`는 연결마다 켜야 한다.** SQLite는 기본이 꺼짐이라
 * 이 한 줄을 빠뜨리면 FK가 선언만 되어 있고 강제되지 않는다 (DES-003 §6).
 */
export function openDatabase(options: OpenDbOptions = {}): Database.Database {
  const path = options.path ?? DB_FILE_PATH;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path, { readonly: options.readonly ?? false });

  db.pragma('foreign_keys = ON');
  // WAL은 읽기와 쓰기가 서로를 막지 않게 한다. 잡(60초 주기)과 요청 처리가
  // 같은 파일을 동시에 건드리므로 기본 journal 모드보다 유리하다.
  if (path !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('busy_timeout = 5000');

  return db;
}
