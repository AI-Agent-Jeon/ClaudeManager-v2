import Database from 'better-sqlite3';
import { runMigrations } from '../../src/backend/db/migrate.js';

/**
 * 테스트용 인메모리 SQLite
 *
 * tests/CLAUDE.md 규칙: DB가 필요한 테스트는 이 픽스처를 쓴다.
 * 파일 DB를 쓰면 테스트끼리 상태를 공유해 "실행 순서에 의존 금지" 규칙이 깨진다.
 */

export interface TestDb {
  db: Database.Database;
  close: () => void;
}

/** 마이그레이션이 전부 적용된 빈 DB를 만든다 */
export function createTestDb(): TestDb {
  const db = new Database(':memory:');
  // 운영과 같은 PRAGMA를 건다. FK를 켜지 않으면 참조 무결성 테스트가
  // 통과해 버려서 아무것도 검증하지 못한다 (DES-003 §6).
  db.pragma('foreign_keys = ON');
  runMigrations(db);

  return {
    db,
    close: () => db.close(),
  };
}

/** ISO 8601 — 모든 타임스탬프 컬럼의 형식 */
export const isoNow = (): string => new Date().toISOString();

// ── 시드 헬퍼 ────────────────────────────────────────────────
// 테스트마다 INSERT 문을 반복해 쓰면 스키마가 바뀔 때 전부 고쳐야 한다.

export function seedProject(
  db: Database.Database,
  overrides: { id?: string; name?: string; status?: string } = {},
): string {
  const id = overrides.id ?? crypto.randomUUID();
  db.prepare(
    'INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)',
  ).run(
    id,
    overrides.name ?? `프로젝트-${id.slice(0, 8)}`,
    '',
    overrides.status ?? 'ready',
    isoNow(),
    isoNow(),
  );
  return id;
}

export function seedAgent(
  db: Database.Database,
  projectId: string,
  overrides: { id?: string; name?: string; status?: string; waitingReason?: string | null } = {},
): string {
  const id = overrides.id ?? crypto.randomUUID();
  db.prepare(
    `INSERT INTO agents (id, project_id, name, type, status, waiting_reason, skill, config,
       retry_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    projectId,
    overrides.name ?? `에이전트-${id.slice(0, 8)}`,
    '',
    overrides.status ?? 'created',
    overrides.waitingReason ?? null,
    '',
    '{}',
    0,
    isoNow(),
    isoNow(),
  );
  return id;
}

/** CH-MAIN은 전역 1개다 — 중복 호출하면 부분 유니크 인덱스가 던진다 */
export function seedMainChannel(db: Database.Database): string {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO conversations (id, channel_type, entity_id, status, created_at) VALUES (?,?,?,?,?)',
  ).run(id, 'main', null, 'active', isoNow());
  return id;
}

export function seedAgentChannel(db: Database.Database, agentId: string): string {
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO conversations (id, channel_type, entity_id, status, created_at) VALUES (?,?,?,?,?)',
  ).run(id, 'agent', agentId, 'active', isoNow());
  return id;
}

export function seedMessage(
  db: Database.Database,
  conversationId: string,
  overrides: {
    id?: string;
    msgType?: string;
    senderRole?: string;
    body?: string;
    structured?: string | null;
    createdAt?: string;
  } = {},
): string {
  const id = overrides.id ?? crypto.randomUUID();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, msg_type, sender_role, body, structured, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    id,
    conversationId,
    overrides.msgType ?? 'MSG-01',
    overrides.senderRole ?? 'ceo',
    overrides.body ?? `메시지-${id.slice(0, 8)}`,
    overrides.structured ?? null,
    overrides.createdAt ?? isoNow(),
  );
  return id;
}

export function seedPhase(
  db: Database.Database,
  overrides: { number?: number; name?: string } = {},
): string {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO phases (id, number, name, started_at) VALUES (?,?,?,?)').run(
    id,
    overrides.number ?? 1,
    overrides.name ?? '기반 구축',
    isoNow(),
  );
  return id;
}

/** Phase당 7단계를 한 번에 심는다 — UNIQUE(phase_id, skill)가 7행을 보장한다 */
export function seedStages(db: Database.Database, phaseId: string): Record<string, string> {
  const skills = ['plan', 'analyze', 'design', 'develop', 'test', 'deploy', 'operate'] as const;
  const stmt = db.prepare('INSERT INTO stages (id, phase_id, skill, status) VALUES (?,?,?,?)');
  const ids: Record<string, string> = {};

  for (const skill of skills) {
    const id = crypto.randomUUID();
    stmt.run(id, phaseId, skill, 'pending');
    ids[skill] = id;
  }
  return ids;
}

export interface SeedApprovalOverrides {
  id?: string;
  messageId?: string | null;
  stageId?: string | null;
  approvalType?: string;
  level?: string;
  subject?: string;
  options?: string | null;
  artifacts?: string | null;
  rationale?: string | null;
  impact?: string | null;
  requestedBy?: string;
  deadlineAt?: string | null;
  status?: string;
  resolution?: string | null;
  reason?: string | null;
  resolvedAt?: string | null;
  createdAt?: string;
}

/** level='high'일 때 deadlineAt 기본값(무기한 null)을 계산한다 — DES-003 §4-1 CHECK (2) */
function defaultDeadlineAt(level: string): string | null {
  return level === 'high' ? null : isoNow();
}

/** overrides가 명시하지 않은 필드의 기본값. id·level에 의존하는 파생값만 인자로 받는다 */
function seedApprovalDefaults(
  id: string,
  level: string,
): Required<Omit<SeedApprovalOverrides, 'id'>> {
  return {
    messageId: null,
    stageId: null,
    approvalType: 'APV-CHOICE',
    level,
    subject: `안건-${id.slice(0, 8)}`,
    options: JSON.stringify([{ code: 'A', label: '승인' }]),
    artifacts: null,
    rationale: null,
    impact: null,
    requestedBy: 'main',
    deadlineAt: defaultDeadlineAt(level),
    status: 'pending',
    resolution: null,
    reason: null,
    resolvedAt: null,
    createdAt: isoNow(),
  };
}

export interface SeedArtifactOverrides {
  id?: string;
  code?: string;
  title?: string;
  status?: string;
  notionUrl?: string | null;
  gitPath?: string | null;
  updatedAt?: string;
}

/** artifacts — DES-003 v2.1 §4-4 */
export function seedArtifact(
  db: Database.Database,
  stageId: string,
  overrides: SeedArtifactOverrides = {},
): string {
  const id = overrides.id ?? crypto.randomUUID();
  const code = overrides.code ?? `DOC-${id.slice(0, 8)}`;
  db.prepare(
    `INSERT INTO artifacts (id, stage_id, code, title, status, notion_url, git_path, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    stageId,
    code,
    overrides.title ?? code,
    overrides.status ?? 'draft',
    overrides.notionUrl ?? null,
    overrides.gitPath ?? null,
    overrides.updatedAt ?? isoNow(),
  );
  return id;
}

/** approvals — DES-003 v2.1 §4-1 */
export function seedApproval(db: Database.Database, overrides: SeedApprovalOverrides = {}): string {
  const id = overrides.id ?? crypto.randomUUID();
  const level = overrides.level ?? 'high';
  const row = { id, ...seedApprovalDefaults(id, level), ...overrides };

  db.prepare(
    `INSERT INTO approvals (id, message_id, stage_id, approval_type, level, subject, options,
       artifacts, rationale, impact, requested_by, deadline_at, status, resolution, reason,
       resolved_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id,
    row.messageId,
    row.stageId,
    row.approvalType,
    row.level,
    row.subject,
    row.options,
    row.artifacts,
    row.rationale,
    row.impact,
    row.requestedBy,
    row.deadlineAt,
    row.status,
    row.resolution,
    row.reason,
    row.resolvedAt,
    row.createdAt,
  );
  return id;
}
