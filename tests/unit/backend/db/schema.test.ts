import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from '../../../../src/backend/db/schema.js';
import { createTestDb } from '../../../fixtures/test-db.js';

/**
 * Drizzle 스키마 ↔ 마이그레이션 SQL 정합
 *
 * `schema.ts`는 스키마의 원본이 아니라 **쿼리 타입을 위한 거울**이다
 * (DES-003 v2.1 §9-1). 거울이 원본과 어긋나면 컴파일은 통과하는데 런타임에
 * "no such column"이 난다. 이 테스트가 그 어긋남을 잡는다.
 */

const TABLES = [
  schema.projects,
  schema.agents,
  schema.tasks,
  schema.statusChanges,
  schema.conversations,
  schema.messages,
  schema.phases,
  schema.stages,
  schema.approvals,
  schema.artifacts,
  schema.wipWaivers,
];

interface PragmaColumn {
  name: string;
  notnull: number;
  pk: number;
}

describe('schema.ts ↔ migrations/*.sql', () => {
  it('선언한 테이블 11종이 실제 DB에 있다', () => {
    const { db, close } = createTestDb();
    try {
      const actual = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => (r as { name: string }).name),
      );

      for (const table of TABLES) {
        expect(actual).toContain(getTableConfig(table).name);
      }
    } finally {
      close();
    }
  });

  it('테이블마다 컬럼 이름이 정확히 일치한다', () => {
    const { db, close } = createTestDb();
    try {
      for (const table of TABLES) {
        const { name, columns } = getTableConfig(table);

        const actual = (db.prepare(`PRAGMA table_info(${name})`).all() as PragmaColumn[])
          .map((c) => c.name)
          .sort();
        const declared = columns.map((c) => c.name).sort();

        // 어느 테이블이 어긋났는지 보이도록 테이블명을 메시지에 남긴다
        expect(`${name}: ${declared.join(',')}`).toBe(`${name}: ${actual.join(',')}`);
      }
    } finally {
      close();
    }
  });

  it('NOT NULL 선언이 실제 제약과 일치한다', () => {
    const { db, close } = createTestDb();
    try {
      for (const table of TABLES) {
        const { name, columns } = getTableConfig(table);
        const actual = new Map(
          (db.prepare(`PRAGMA table_info(${name})`).all() as PragmaColumn[]).map((c) => [
            c.name,
            c.notnull === 1 || c.pk === 1,
          ]),
        );

        for (const col of columns) {
          expect(`${name}.${col.name}=${col.notNull}`).toBe(
            `${name}.${col.name}=${actual.get(col.name)}`,
          );
        }
      }
    } finally {
      close();
    }
  });

  it('conversations.entity_id에는 FK가 없다 — D-27', () => {
    const { db, close } = createTestDb();
    try {
      const fks = db.prepare('PRAGMA foreign_key_list(conversations)').all();
      // FK + CASCADE를 걸면 Agent 삭제 시 대화가 함께 사라진다
      expect(fks).toHaveLength(0);
    } finally {
      close();
    }
  });

  it('stages에는 gate_approval_id가 없다 — 순환 FK 제거', () => {
    const { db, close } = createTestDb();
    try {
      const cols = (db.prepare('PRAGMA table_info(stages)').all() as PragmaColumn[]).map(
        (c) => c.name,
      );
      expect(cols).not.toContain('gate_approval_id');
    } finally {
      close();
    }
  });

  it('artifacts에는 sync_status 컬럼이 없다 — 파생값이다', () => {
    const { db, close } = createTestDb();
    try {
      const cols = (db.prepare('PRAGMA table_info(artifacts)').all() as PragmaColumn[]).map(
        (c) => c.name,
      );
      expect(cols).not.toContain('sync_status');
    } finally {
      close();
    }
  });
});
