import type BetterSqlite3 from 'better-sqlite3';

/**
 * MessageRepository — 메시지 CRUD + FTS5 전문 검색 (FR-027)
 *
 * 정의 원본: DES-004 v2.2 §14 · §전체 함수 시그니처 요약 (Repositories 시그니처는
 * 미작성 상태 — ConversationService 계약에서 기계적으로 도출했다. §미해결 사항 참조)
 * DB 스키마: DES-003 v2.1 §3-2·§3-3 (migrations/002_conversations.sql — FTS5 external content)
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙 3): Repository는 쿼리만 수행한다.
 * approvalId 조회는 approvals를 LEFT JOIN해 한 번의 쿼리로 끝낸다 — 메시지마다
 * 별도 왕복 쿼리를 던지면 목록 조회가 N+1이 된다.
 */

/** DB 행 그대로 — snake_case. approval_id는 저장 컬럼이 아니라 JOIN 결과다 */
export interface MessageRow {
  id: string;
  conversation_id: string;
  msg_type: string;
  sender_role: string;
  body: string;
  structured: string | null;
  created_at: string;
  /** approvals.id — msgType이 'MSG-04'가 아니면 항상 null */
  approval_id: string | null;
}

/** insert 입력 — camelCase */
export interface MessageInsertRow {
  id: string;
  conversationId: string;
  msgType: string;
  senderRole: string;
  body: string;
  structured: string | null;
  createdAt: string;
}

/** 커서 페이지네이션 경계 — created_at + id 복합 키 (DES-004 §14) */
export interface CursorBound {
  createdAt: string;
  id: string;
}

export interface SearchOpts {
  q: string;
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  limit: number;
}

/** FTS5 검색 결과 행 — conversationTitle 파생에 필요한 필드까지 한 쿼리로 가져온다 */
export interface SearchRow {
  id: string;
  conversation_id: string;
  channel_type: string;
  status: string;
  entity_snapshot: string | null;
  agent_name: string | null;
  created_at: string;
  snippet: string;
}

const SELECT_WITH_APPROVAL = `
  SELECT m.*, ap.id AS approval_id
  FROM messages m
  LEFT JOIN approvals ap ON ap.message_id = m.id
`;

export class MessageRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(row: MessageInsertRow): MessageRow {
    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, msg_type, sender_role, body, structured, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.conversationId,
        row.msgType,
        row.senderRole,
        row.body,
        row.structured,
        row.createdAt,
      );
    return this.findById(row.id) as MessageRow;
  }

  findById(id: string): MessageRow | null {
    const row = this.db.prepare(`${SELECT_WITH_APPROVAL} WHERE m.id = ?`).get(id) as
      | MessageRow
      | undefined;
    return row ?? null;
  }

  /** 채널의 가장 최근 메시지 1건 — Conversation.lastMessageAt 파생용 */
  findLatest(conversationId: string): MessageRow | null {
    const row = this.db
      .prepare(
        `${SELECT_WITH_APPROVAL} WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT 1`,
      )
      .get(conversationId) as MessageRow | undefined;
    return row ?? null;
  }

  /**
   * 커서 페이지네이션 (DES-004 §14). cursor가 없으면(첫 페이지) 최신순으로 반환한다.
   * `limit+1`건 조회 → 초과분 유무로 `hasMore` 판정은 호출자(Service)의 책임이다 —
   * 여기서는 요청받은 limit 그대로 LIMIT 절에 쓴다.
   */
  listByCursor(
    conversationId: string,
    cursor: CursorBound | null,
    direction: 'before' | 'after',
    limit: number,
  ): MessageRow[] {
    if (!cursor) {
      return this.db
        .prepare(
          `${SELECT_WITH_APPROVAL} WHERE m.conversation_id = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
        )
        .all(conversationId, limit) as MessageRow[];
    }

    if (direction === 'after') {
      return this.db
        .prepare(
          `${SELECT_WITH_APPROVAL}
           WHERE m.conversation_id = ?
             AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
           ORDER BY m.created_at ASC, m.id ASC LIMIT ?`,
        )
        .all(conversationId, cursor.createdAt, cursor.createdAt, cursor.id, limit) as MessageRow[];
    }

    return this.db
      .prepare(
        `${SELECT_WITH_APPROVAL}
         WHERE m.conversation_id = ?
           AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))
         ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
      )
      .all(conversationId, cursor.createdAt, cursor.createdAt, cursor.id, limit) as MessageRow[];
  }

  /** 내보내기 전용 — 채널 전체를 시간순(오래된 것부터)으로 반환한다 */
  /**
   * 읽음 포인터 이후에 온 메시지 수 (DEV-D-05).
   *
   * `lastReadAt`이 NULL이면 한 번도 열지 않은 채널이므로 전체가 미읽음이다.
   * (conversation_id, created_at) 인덱스 messages_conv_idx를 그대로 쓴다.
   */
  countUnread(conversationId: string, lastReadAt: string | null): number {
    const sql = lastReadAt
      ? 'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND created_at > ?'
      : 'SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?';
    const params = lastReadAt ? [conversationId, lastReadAt] : [conversationId];

    return (this.db.prepare(sql).get(...params) as { n: number }).n;
  }

  listAll(conversationId: string): MessageRow[] {
    return this.db
      .prepare(
        `${SELECT_WITH_APPROVAL} WHERE m.conversation_id = ? ORDER BY m.created_at ASC, m.id ASC`,
      )
      .all(conversationId) as MessageRow[];
  }

  /** FTS5 전문 검색 (FR-027 · ADR-011) — snippet()으로 하이라이트 구간을 만든다 */
  search(opts: SearchOpts): SearchRow[] {
    const where: string[] = [];
    const params: unknown[] = [opts.q];

    if (opts.type) {
      where.push('c.channel_type = ?');
      params.push(opts.type);
    }
    if (opts.status) {
      where.push('c.status = ?');
      params.push(opts.status);
    }
    if (opts.from) {
      where.push('m.created_at >= ?');
      params.push(opts.from);
    }
    if (opts.to) {
      where.push('m.created_at <= ?');
      params.push(opts.to);
    }

    const clause = where.length > 0 ? `AND ${where.join(' AND ')}` : '';
    params.push(opts.limit);

    return this.db
      .prepare(
        `SELECT m.id, m.conversation_id, c.channel_type, c.status, c.entity_snapshot,
                a.name AS agent_name, m.created_at,
                snippet(messages_fts, 0, '<mark>', '</mark>', '…', 10) AS snippet
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN agents a ON a.id = c.entity_id
         WHERE messages_fts MATCH ? ${clause}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...params) as SearchRow[];
  }
}
