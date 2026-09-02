import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactRepository } from '../../../../src/backend/repositories/artifact.repository.js';
import {
  ArtifactService,
  deriveSyncStatus,
} from '../../../../src/backend/services/artifact.service.js';
import type { AppError } from '../../../../src/backend/utils/errors.js';
import {
  createTestDb,
  seedArtifact,
  seedPhase,
  seedStages,
  type TestDb,
} from '../../../fixtures/test-db.js';

/**
 * ArtifactService (FR-031)
 *
 * 정의 원본: DES-004 §전체 함수 시그니처 요약(ArtifactService) ·
 * DES-002 v2.1 §5 · DES-003 v2.1 §4-4
 */

describe('deriveSyncStatus — 4분기 전건 (DES-003 §4-4, FR-031 회귀 방어선)', () => {
  it('notionUrl·gitPath 둘 다 있으면 synced', () => {
    expect(deriveSyncStatus('https://notion/x', 'docs/x.md')).toBe('synced');
  });

  it('notionUrl만 있으면 notion_only (Git 동기화 누락)', () => {
    expect(deriveSyncStatus('https://notion/x', null)).toBe('notion_only');
  });

  it('gitPath만 있으면 git_only', () => {
    expect(deriveSyncStatus(null, 'docs/x.md')).toBe('git_only');
  });

  it('둘 다 없으면 missing', () => {
    expect(deriveSyncStatus(null, null)).toBe('missing');
  });

  it('notion_only와 missing은 서로 다른 값이다 — 2026-09-01 오진단의 재현 방지', () => {
    const notionOnly = deriveSyncStatus('https://notion/x', null);
    const missing = deriveSyncStatus(null, null);
    expect(notionOnly).not.toBe(missing);
  });

  it('빈 문자열은 "없음"으로 취급한다', () => {
    expect(deriveSyncStatus('', '')).toBe('missing');
    expect(deriveSyncStatus('https://notion/x', '')).toBe('notion_only');
  });
});

let testDb: TestDb;
let repo: ArtifactRepository;
let service: ArtifactService;
let stageId: string;

beforeEach(() => {
  testDb = createTestDb();
  repo = new ArtifactRepository(testDb.db);
  service = new ArtifactService(repo);
  const phaseId = seedPhase(testDb.db);
  const stages = seedStages(testDb.db, phaseId);
  stageId = stages.plan as string;
});

afterEach(() => {
  testDb.close();
});

describe('ArtifactService.list', () => {
  it('Repository 조회 결과를 Artifact(syncStatus 파생 포함)로 변환한다', async () => {
    seedArtifact(testDb.db, stageId, {
      code: 'PLN-001',
      notionUrl: 'https://notion/pln-001',
      gitPath: null,
    });

    const rows = await service.list({});
    expect(rows.length).toBe(1);
    expect(rows[0]?.syncStatus).toBe('notion_only');
  });

  it('stage·syncStatus 필터를 그대로 Repository에 전달한다', async () => {
    seedArtifact(testDb.db, stageId, { code: 'A', notionUrl: null, gitPath: null });
    seedArtifact(testDb.db, stageId, {
      code: 'B',
      notionUrl: 'https://notion/b',
      gitPath: 'docs/b.md',
    });

    const rows = await service.list({ stage: stageId, syncStatus: 'synced' });
    expect(rows.map((r) => r.code)).toEqual(['B']);
  });
});

describe('ArtifactService.getById', () => {
  it('존재하지 않으면 404 NOT_FOUND', async () => {
    await expect(service.getById(crypto.randomUUID())).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('존재하면 파생 syncStatus를 포함한 Artifact를 돌려준다', async () => {
    const id = seedArtifact(testDb.db, stageId, {
      code: 'PLN-002',
      notionUrl: 'https://notion/x',
      gitPath: 'docs/x.md',
    });

    const artifact = await service.getById(id);
    expect(artifact.code).toBe('PLN-002');
    expect(artifact.syncStatus).toBe('synced');
  });
});

describe('ArtifactService.upsert', () => {
  it('신규 code면 새 Artifact를 생성한다', async () => {
    const artifact = await service.upsert({
      stageId,
      code: 'UP-001',
      title: '신규',
    });
    expect(artifact.code).toBe('UP-001');
    expect(artifact.status).toBe('draft');
    expect(artifact.syncStatus).toBe('missing');
  });

  it('기존 code면 갱신한다 (id 유지)', async () => {
    const first = await service.upsert({ stageId, code: 'UP-002', title: '최초' });
    const second = await service.upsert({
      stageId,
      code: 'UP-002',
      title: '갱신',
      gitPath: 'docs/up-002.md',
    });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('갱신');
    expect(second.syncStatus).toBe('git_only');
  });
});

describe('ArtifactService.getContent — 보안', () => {
  it('산출물이 존재하지 않으면 404 NOT_FOUND', async () => {
    await expect(service.getContent(crypto.randomUUID())).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('gitPath가 null이면 404 NOT_FOUND (notion_only·missing)', async () => {
    const id = seedArtifact(testDb.db, stageId, {
      code: 'NO-GIT',
      notionUrl: 'https://notion/x',
      gitPath: null,
    });
    await expect(service.getContent(id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('gitPath가 빈 문자열이면 404 NOT_FOUND', async () => {
    const id = seedArtifact(testDb.db, stageId, { code: 'EMPTY-GIT', gitPath: '' });
    await expect(service.getContent(id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('실제로 존재하는 저장소 내부 파일이면 본문을 돌려준다', async () => {
    // 이 저장소에 실제로 존재하는 문서를 대상으로 삼는다 — REPO_ROOT 기준
    // 상대 경로 해석이 올바른지를 실 파일로 검증한다.
    const id = seedArtifact(testDb.db, stageId, {
      code: 'REAL-DOC',
      gitPath: 'CHANGELOG.md',
    });
    const content = await service.getContent(id);
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('CHANGELOG');
  });

  it('존재하지 않는 파일이면 404 NOT_FOUND (OS 에러 원문을 노출하지 않는다)', async () => {
    const id = seedArtifact(testDb.db, stageId, {
      code: 'GHOST',
      gitPath: 'docs/does-not-exist-xyz.md',
    });
    await expect(service.getContent(id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('절대 경로는 거부된다', async () => {
    const id = seedArtifact(testDb.db, stageId, {
      code: 'ABS',
      gitPath: resolve(process.cwd(), 'CHANGELOG.md'),
    });
    await expect(service.getContent(id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('".."로 저장소 루트를 벗어나는 경로는 거부된다 — 실제 외부 파일이 있어도 읽지 못한다', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'cm-artifact-test-'));
    const outsideFile = join(outsideDir, 'secret.txt');
    writeFileSync(outsideFile, 'top-secret', 'utf8');

    try {
      // REPO_ROOT 기준 상대 경로로 표현한 상위 탈출 경로
      const traversalPath = relative(process.cwd(), outsideFile).split('\\').join('/');
      const id = seedArtifact(testDb.db, stageId, { code: 'ESCAPE', gitPath: traversalPath });

      await expect(service.getContent(id)).rejects.toMatchObject({
        statusCode: 404,
        code: 'NOT_FOUND',
      });
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('URL 인코딩된 상위 탈출 시도(..%2F)도 존재하지 않는 파일로 취급되어 거부된다', async () => {
    const id = seedArtifact(testDb.db, stageId, {
      code: 'ENCODED-ESCAPE',
      gitPath: '..%2F..%2Fetc%2Fpasswd',
    });
    await expect(service.getContent(id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('디렉터리를 가리키면 404 NOT_FOUND (파일이 아니다)', async () => {
    const id = seedArtifact(testDb.db, stageId, { code: 'IS-DIR', gitPath: 'docs' });
    await expect(service.getContent(id)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
    });
  });

  it('에러 메시지에 파일 시스템 경로가 노출되지 않는다', async () => {
    const id = seedArtifact(testDb.db, stageId, {
      code: 'NO-LEAK',
      gitPath: 'docs/does-not-exist-xyz.md',
    });
    try {
      await service.getContent(id);
      expect.unreachable();
    } catch (e) {
      const message = (e as AppError).message;
      expect(message).not.toContain(process.cwd());
      expect(message).not.toContain('ENOENT');
    }
  });
});
