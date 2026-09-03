import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCode, SyncStatus } from '../../shared/constants.js';
import type { Artifact, ListArtifactsOpts, UpsertArtifactInput } from '../../shared/types.js';
import type { ArtifactRepository, ArtifactRow } from '../repositories/artifact.repository.js';
import { AppError } from '../utils/errors.js';

/**
 * ArtifactService (FR-031 산출물 동기화 추적)
 *
 * 정의 원본: DES-004 §전체 함수 시그니처 요약(ArtifactService) ·
 * DES-002 v2.1 §5(GET /api/artifacts · GET /api/artifacts/:id/content)
 * DB 스키마: DES-003 v2.1 §4-4 (migrations/005_artifacts.sql)
 *
 * ── syncStatus 파생 — 이 계층의 존재 이유 ─────────────────────────
 * 저장하지 않고 `notionUrl`·`gitPath` 유무에서 파생한다. `notion_only`와
 * `missing`의 구분이 FR-031의 존재 이유다 — 2026-09-01 "analyze 건너뜀"
 * 오진단이 정확히 이 둘을 혼동한 사고였다. `deriveSyncStatus`는 모듈
 * 스코프의 순수 함수로 둔다(export) — DES-004는 클래스 내부 private
 * 메서드로 적었지만, "notion_only와 missing이 구분되는지"를 이 계층의
 * 회귀 방어선으로 직접 단위 테스트해야 하므로(개발 지시 §6)
 * `stage-mapper.ts`의 `isGateRequired` 등과 같은 선례를 따라 최상위
 * 함수로 분리했다 — 클래스 프라이빗 메서드는 `list()`/`upsert()`를 통해
 * 간접 검증만 가능해 4분기를 명시적으로 덮기 어렵다.
 */

/** 빈 문자열도 "없음"으로 취급한다 — artifact.repository.ts 상단 주석과 같은 기준 */
function isPresent(value: string | null): value is string {
  return value !== null && value !== '';
}

export function deriveSyncStatus(notionUrl: string | null, gitPath: string | null): SyncStatus {
  const hasNotion = isPresent(notionUrl);
  const hasGit = isPresent(gitPath);
  if (hasNotion && hasGit) return SyncStatus.SYNCED;
  if (hasNotion && !hasGit) return SyncStatus.NOTION_ONLY;
  if (!hasNotion && hasGit) return SyncStatus.GIT_ONLY;
  return SyncStatus.MISSING;
}

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    stageId: row.stage_id,
    code: row.code,
    title: row.title,
    status: row.status as Artifact['status'],
    notionUrl: row.notion_url,
    gitPath: row.git_path,
    syncStatus: deriveSyncStatus(row.notion_url, row.git_path),
    updatedAt: row.updated_at,
  };
}

// ── getContent() 보안 ────────────────────────────────────────────
// `git_path`는 저장소 루트 기준 상대 경로다. 절대 경로·`..` 상위 탈출을
// 거부하고, 정규화 후 저장소 루트 밖을 가리키면 읽지 않는다.

/**
 * 저장소 루트 — 이 파일(`src/backend/services/artifact.service.ts`) 기준
 * 3단계 상위(`services` → `backend` → `src` → 루트). `db/index.ts`가
 * `import.meta.url` + `fileURLToPath`로 자기 위치를 구하는 것과 같은 패턴 —
 * `process.cwd()`는 서버를 어느 디렉터리에서 기동했는지에 따라 달라져
 * 신뢰할 수 없다.
 */
const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

/**
 * 본문 읽기 크기 상한 — 등급 낮음, 자율 판단.
 * 설계 산출물은 대부분 마크다운 문서라 수백 KB를 넘지 않는다. 2MB로 잡아
 * 정상 문서를 넉넉히 수용하면서, 잘못 연결된 대용량 바이너리를 통째로
 * 메모리에 올리는 사고를 막는다.
 */
const MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/**
 * `gitPath`를 저장소 루트 기준 절대 경로로 정규화하고, 탈출 여부를 검사한다.
 * 절대 경로 입력이거나(`isAbsolute`), 정규화 후 저장소 루트 밖을 가리키면
 * `null`을 돌려준다 — 호출부는 이를 "파일 없음"과 동일하게 404로 처리해
 * 경로 주입 시도와 단순 미존재를 클라이언트에 구분해 노출하지 않는다.
 */
function resolveSafeGitPath(gitPath: string): string | null {
  if (isAbsolute(gitPath)) return null;

  const resolved = resolve(REPO_ROOT, gitPath);
  if (resolved !== REPO_ROOT && !resolved.startsWith(REPO_ROOT + sep)) return null;
  return resolved;
}

export class ArtifactService {
  constructor(private readonly artifactRepo: ArtifactRepository) {}

  /**
   * FR-031 — `stage`·`syncStatus` 필터는 Repository가 SQL로 구성한다
   * (전건을 메모리로 읽어와 거르지 않는다, 개발 지시 §2).
   */
  async list(opts: ListArtifactsOpts): Promise<Artifact[]> {
    const rows = this.artifactRepo.findMany({
      stageId: opts.stage,
      syncStatus: opts.syncStatus,
    });
    return rows.map(toArtifact);
  }

  /**
   * FR-031 — 산출물 1건 조회. `ApprovalService`의 스텁 교체(§3)가 코드로
   * 조회할 때는 `findByCode`/`findByCodes`를 직접 쓴다 — 이 메서드는 id
   * 기준 조회(라우트 파라미터)에만 쓴다.
   */
  async getById(id: string): Promise<Artifact> {
    const row = this.artifactRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `산출물을 찾을 수 없습니다: ${id}`);
    }
    return toArtifact(row);
  }

  /**
   * FR-031 — 본문 조회 (검토 패널). `git_path`가 없으면(=`notion_only`·
   * `missing`) 404. 경로 주입 시도·상위 탈출·존재하지 않는 파일 모두
   * 동일하게 404 NOT_FOUND로 응답한다 — DES-002 §7이 이 엔드포인트에
   * `NOT_FOUND` 하나만 매핑하고, 파일 시스템 경로·OS 에러 원문은 노출하지
   * 않는다(기존 계층 규칙).
   */
  async getContent(id: string): Promise<string> {
    const row = this.artifactRepo.findById(id);
    if (!row) {
      throw new AppError(404, ErrorCode.NOT_FOUND, `산출물을 찾을 수 없습니다: ${id}`);
    }
    if (!isPresent(row.git_path)) {
      throw new AppError(404, ErrorCode.NOT_FOUND, '연결된 Git 경로가 없습니다');
    }

    const safePath = resolveSafeGitPath(row.git_path);
    if (!safePath) {
      throw new AppError(404, ErrorCode.NOT_FOUND, '파일을 찾을 수 없습니다');
    }

    try {
      const stat = statSync(safePath);
      if (!stat.isFile() || stat.size > MAX_CONTENT_BYTES) {
        throw new AppError(404, ErrorCode.NOT_FOUND, '파일을 찾을 수 없습니다');
      }
      return readFileSync(safePath, 'utf8');
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      // ENOENT 등 OS 에러 원문(경로 포함)을 그대로 노출하지 않는다
      throw new AppError(404, ErrorCode.NOT_FOUND, '파일을 찾을 수 없습니다');
    }
  }

  /**
   * FR-031 — 산출물 upsert. `code` UNIQUE 기준으로 신규 생성/기존 갱신을
   * 나눈다(Repository의 `ON CONFLICT(code) DO UPDATE`). `status`는 입력에
   * 없다 — 승인 흐름이 별도로 관리하는 값이라 upsert가 되돌리지 않는다
   * (artifact.repository.ts 상단 주석).
   */
  async upsert(input: UpsertArtifactInput): Promise<Artifact> {
    const row = this.artifactRepo.upsert({
      id: crypto.randomUUID(),
      stageId: input.stageId,
      code: input.code,
      title: input.title,
      notionUrl: input.notionUrl ?? null,
      gitPath: input.gitPath ?? null,
      updatedAt: new Date().toISOString(),
    });
    return toArtifact(row);
  }
}
