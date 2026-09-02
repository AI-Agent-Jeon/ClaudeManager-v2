import type BetterSqlite3 from 'better-sqlite3';

/**
 * ConversationRepository — 대화 채널 CRUD (FR-026)
 *
 * 정의 원본: DES-004 v2.2 §14·§18 · §전체 함수 시그니처 요약 (Repositories 시그니처는
 * 미작성 상태 — ConversationService 계약에서 기계적으로 도출했다. §미해결 사항 참조)
 * DB 스키마: DES-003 v2.1 §3-1 (migrations/002_conversations.sql)
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙 3): Repository는 쿼리만 수행한다.
 * 비즈니스 로직(title 파생, unreadCount 계산 등)은 두지 않는다 — Service의 몫이다.
 */

/** DB 행 그대로 — snake_case */
export interface ConversationRow {
  id: string;
  channel_type: string;
  entity_id: string | null;
  status: string;
  entity_snapshot: string | null;
  created_at: string;
  archived_at: string | null;
  /** 읽음 포인터. NULL = 한 번도 열지 않음 (DEV-D-05, 마이그레이션 007) */
  last_read_at: string | null;
}

/**
 * 목록·상세 조회 전용 — title 파생을 위해 agents를 LEFT JOIN한 확장 행.
 * Agent가 삭제된(아카이브) 채널이거나 channel_type='main'이면 agent_name·project_id는 null이다.
 */
export interface ConversationWithAgentRow extends ConversationRow {
  agent_name: string | null;
  project_id: string | null;
}

/** insert 입력 — camelCase */
export interface ConversationInsertRow {
  id: string;
  channelType: string;
  entityId: string | null;
  status: string;
  createdAt: string;
}

export interface FindManyOpts {
  type?: string;
  status?: string;
  /** agents.project_id 필터 — LEFT JOIN에 의존한다(아카이브 채널은 Agent가 없어 제외된다) */
  projectId?: string;
  from?: string;
  to?: string;
}

function buildWhere(opts: FindManyOpts): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.type) {
    where.push('c.channel_type = ?');
    params.push(opts.type);
  }
  if (opts.status) {
    where.push('c.status = ?');
    params.push(opts.status);
  }
  if (opts.projectId) {
    where.push('a.project_id = ?');
    params.push(opts.projectId);
  }
  if (opts.from) {
    where.push('c.created_at >= ?');
    params.push(opts.from);
  }
  if (opts.to) {
    where.push('c.created_at <= ?');
    params.push(opts.to);
  }

  return { clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '', params };
}

const SELECT_WITH_AGENT = `
  SELECT c.*, a.name AS agent_name, a.project_id AS project_id
  FROM conversations c
  LEFT JOIN agents a ON c.entity_id = a.id
`;

export class ConversationRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(row: ConversationInsertRow): ConversationRow {
    this.db
      .prepare(
        `INSERT INTO conversations (id, channel_type, entity_id, status, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.channelType, row.entityId, row.status, row.createdAt);
    return this.findById(row.id) as ConversationRow;
  }

  findById(id: string): ConversationRow | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      | ConversationRow
      | undefined;
    return row ?? null;
  }

  /** title 파생을 위해 agents를 조인한 상세 조회 (GET /:id · GET /:id/export) */
  findByIdWithAgent(id: string): ConversationWithAgentRow | null {
    const row = this.db.prepare(`${SELECT_WITH_AGENT} WHERE c.id = ?`).get(id) as
      | ConversationWithAgentRow
      | undefined;
    return row ?? null;
  }

  /** channel_type='agent'인 채널을 entity_id(Agent id)로 찾는다 (D-27) */
  findByEntityId(entityId: string): ConversationRow | null {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE entity_id = ? AND channel_type = 'agent'")
      .get(entityId) as ConversationRow | undefined;
    return row ?? null;
  }

  /** CH-MAIN은 전역 1개다 — 부분 유니크 인덱스가 보장한다 (부트스트랩 R-01) */
  findMainChannel(): ConversationRow | null {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE channel_type = 'main' LIMIT 1")
      .get() as ConversationRow | undefined;
    return row ?? null;
  }

  /** 정렬: created_at DESC (최신 채널이 위) */
  findMany(opts: FindManyOpts): ConversationWithAgentRow[] {
    const { clause, params } = buildWhere(opts);
    return this.db
      .prepare(`${SELECT_WITH_AGENT} ${clause} ORDER BY c.created_at DESC`)
      .all(...params) as ConversationWithAgentRow[];
  }

  updateStatus(id: string, status: string): ConversationRow {
    this.db.prepare('UPDATE conversations SET status = ? WHERE id = ?').run(status, id);
    return this.findById(id) as ConversationRow;
  }

  /** Agent 삭제 시 아카이브 전환 (D-27) — snapshot은 JSON 문자열(snake_case)이다 */
  /**
   * 읽음 포인터를 갱신한다 (DEV-D-05).
   * 대표가 채널을 열거나 메시지를 조회할 때 호출한다.
   */
  markRead(id: string, readAt: string): ConversationRow {
    return this.db
      .prepare('UPDATE conversations SET last_read_at = ? WHERE id = ? RETURNING *')
      .get(readAt, id) as ConversationRow;
  }

  archiveWithSnapshot(id: string, snapshotJson: string, archivedAt: string): ConversationRow {
    this.db
      .prepare(
        "UPDATE conversations SET status = 'archived', entity_snapshot = ?, archived_at = ? WHERE id = ?",
      )
      .run(snapshotJson, archivedAt, id);
    return this.findById(id) as ConversationRow;
  }
}
