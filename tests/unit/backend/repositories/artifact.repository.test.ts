import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactRepository } from '../../../../src/backend/repositories/artifact.repository.js';
import { AppError } from '../../../../src/backend/utils/errors.js';
import {
  createTestDb,
  isoNow,
  seedArtifact,
  seedPhase,
  seedStages,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * ArtifactRepository (FR-031)
 *
 * 정의 원본: DES-004 §전체 함수 시그니처 요약(ArtifactService) ·
 * DES-002 v2.1 §5(GET /api/artifacts) · DES-003 v2.1 §4-4
 *
 * §4-4의 syncStatus 4분기 표(있음/있음→synced 등)를 SQL WHERE 절 기준으로
 * 검증한다 — findMany의 syncStatus 필터가 전건을 메모리로 읽어와 거르지
 * 않고 SQL에서 직접 구성하는지가 이 계층의 핵심 검증 대상이다.
 */

let testDb: TestDb;
let repo: ArtifactRepository;
let stageId: string;

beforeEach(() => {
  testDb = createTestDb();
  repo = new ArtifactRepository(testDb.db);
  const phaseId = seedPhase(testDb.db);
  const stages = seedStages(testDb.db, phaseId);
  stageId = stages.plan as string;
});

afterEach(() => {
  testDb.close();
});

describe('ArtifactRepository.findById / findByCode', () => {
  it('존재하는 id·code로 조회하면 행을 돌려준다', () => {
    const id = seedArtifact(testDb.db, stageId, { code: 'PLN-001' });
    expect(repo.findById(id)?.code).toBe('PLN-001');
    expect(repo.findByCode('PLN-001')?.id).toBe(id);
  });

  it('존재하지 않으면 null', () => {
    expect(repo.findById(crypto.randomUUID())).toBeNull();
    expect(repo.findByCode('NOPE-999')).toBeNull();
  });
});

describe('ArtifactRepository.findByCodes', () => {
  it('코드 배열로 일괄 조회한다 — 존재하지 않는 코드는 결과에서 빠진다', () => {
    seedArtifact(testDb.db, stageId, { code: 'PLN-001' });
    seedArtifact(testDb.db, stageId, { code: 'PLN-002' });

    const rows = repo.findByCodes(['PLN-001', 'PLN-002', 'PLN-999']);
    expect(rows.map((r) => r.code).sort()).toEqual(['PLN-001', 'PLN-002']);
  });

  it('빈 배열이면 쿼리 없이 빈 배열을 돌려준다', () => {
    expect(repo.findByCodes([])).toEqual([]);
  });
});

describe('ArtifactRepository.findMany — syncStatus 4분기 (DES-003 §4-4)', () => {
  it('synced — notionUrl·gitPath 둘 다 있음', () => {
    seedArtifact(testDb.db, stageId, {
      code: 'A',
      notionUrl: 'https://notion/a',
      gitPath: 'docs/a.md',
    });
    const rows = repo.findMany({ syncStatus: 'synced' });
    expect(rows.map((r) => r.code)).toEqual(['A']);
  });

  it('notion_only — notionUrl만 있음 (Git 동기화 누락)', () => {
    seedArtifact(testDb.db, stageId, { code: 'B', notionUrl: 'https://notion/b', gitPath: null });
    const rows = repo.findMany({ syncStatus: 'notion_only' });
    expect(rows.map((r) => r.code)).toEqual(['B']);
  });

  it('git_only — gitPath만 있음', () => {
    seedArtifact(testDb.db, stageId, { code: 'C', notionUrl: null, gitPath: 'docs/c.md' });
    const rows = repo.findMany({ syncStatus: 'git_only' });
    expect(rows.map((r) => r.code)).toEqual(['C']);
  });

  it('missing — 둘 다 없음', () => {
    seedArtifact(testDb.db, stageId, { code: 'D', notionUrl: null, gitPath: null });
    const rows = repo.findMany({ syncStatus: 'missing' });
    expect(rows.map((r) => r.code)).toEqual(['D']);
  });

  it('notion_only와 missing이 서로 섞이지 않는다 — FR-031 회귀 방어선', () => {
    seedArtifact(testDb.db, stageId, {
      code: 'NOTION-ONLY',
      notionUrl: 'https://notion/x',
      gitPath: null,
    });
    seedArtifact(testDb.db, stageId, { code: 'MISSING', notionUrl: null, gitPath: null });

    const notionOnly = repo.findMany({ syncStatus: 'notion_only' });
    const missing = repo.findMany({ syncStatus: 'missing' });

    expect(notionOnly.map((r) => r.code)).toEqual(['NOTION-ONLY']);
    expect(missing.map((r) => r.code)).toEqual(['MISSING']);
  });

  it('빈 문자열도 "없음"으로 취급한다', () => {
    seedArtifact(testDb.db, stageId, { code: 'EMPTY', notionUrl: '', gitPath: '' });
    const rows = repo.findMany({ syncStatus: 'missing' });
    expect(rows.map((r) => r.code)).toEqual(['EMPTY']);
  });

  it('필터 없이 호출하면 전건을 돌려준다', () => {
    seedArtifact(testDb.db, stageId, { code: 'A' });
    seedArtifact(testDb.db, stageId, { code: 'B' });
    expect(repo.findMany({}).length).toBe(2);
  });
});

describe('ArtifactRepository.findMany — stage 필터', () => {
  it('stageId로 필터링한다', () => {
    const phaseId = seedPhase(testDb.db, { number: 2 });
    const otherStages = seedStages(testDb.db, phaseId);

    seedArtifact(testDb.db, stageId, { code: 'PLAN-DOC' });
    seedArtifact(testDb.db, otherStages.analyze as string, { code: 'ANALYZE-DOC' });

    const rows = repo.findMany({ stageId });
    expect(rows.map((r) => r.code)).toEqual(['PLAN-DOC']);
  });
});

describe('ArtifactRepository.upsert', () => {
  it('신규 code면 새 행을 만든다 (status는 draft 기본값)', () => {
    const row = repo.upsert({
      id: crypto.randomUUID(),
      stageId,
      code: 'NEW-001',
      title: '신규 문서',
      notionUrl: null,
      gitPath: null,
      updatedAt: isoNow(),
    });

    expect(row.code).toBe('NEW-001');
    expect(row.status).toBe('draft');
    expect(row.title).toBe('신규 문서');
  });

  it('기존 code면 stage_id·title·notion_url·git_path·updated_at만 갱신하고 id·status는 유지한다', () => {
    const id = seedArtifact(testDb.db, stageId, {
      code: 'DUP-001',
      title: '원본 제목',
      status: 'approved',
      notionUrl: null,
      gitPath: null,
    });

    const updated = repo.upsert({
      id: crypto.randomUUID(), // 다른 id를 넘겨도 기존 행의 id가 유지된다
      stageId,
      code: 'DUP-001',
      title: '갱신된 제목',
      notionUrl: 'https://notion/dup',
      gitPath: 'docs/dup.md',
      updatedAt: isoNow(),
    });

    expect(updated.id).toBe(id);
    expect(updated.title).toBe('갱신된 제목');
    expect(updated.notion_url).toBe('https://notion/dup');
    expect(updated.git_path).toBe('docs/dup.md');
    // status는 upsert 대상이 아니다 — 승인 흐름이 별도로 관리한다
    expect(updated.status).toBe('approved');

    const count = (
      testDb.db.prepare('SELECT COUNT(*) AS n FROM artifacts WHERE code = ?').get('DUP-001') as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it('존재하지 않는 stageId면 404 STAGE_NOT_FOUND (FK 위반 변환)', () => {
    const insert = () =>
      repo.upsert({
        id: crypto.randomUUID(),
        stageId: crypto.randomUUID(),
        code: 'ORPHAN-001',
        title: '고아 문서',
        notionUrl: null,
        gitPath: null,
        updatedAt: isoNow(),
      });

    expect(insert).toThrow(AppError);
    try {
      insert();
    } catch (e) {
      expect((e as AppError).statusCode).toBe(404);
      expect((e as AppError).code).toBe('STAGE_NOT_FOUND');
    }
  });
});
