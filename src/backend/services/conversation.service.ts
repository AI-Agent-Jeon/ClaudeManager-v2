import {
  ChannelType,
  ConversationStatus,
  ErrorCode,
  MessageType,
  SenderRole,
} from '../../shared/constants.js';
import type {
  Conversation,
  CursorResponse,
  EntitySnapshot,
  ListConversationsOpts,
  ListMessagesOpts,
  Message,
  SearchMessagesOpts,
  SearchResult,
  SendMessageInput,
  StructuredReport,
} from '../../shared/types.js';
import type {
  ConversationRepository,
  ConversationRow,
  ConversationWithAgentRow,
} from '../repositories/conversation.repository.js';
import type {
  MessageRepository,
  MessageRow,
  SearchRow,
} from '../repositories/message.repository.js';
import { AppError } from '../utils/errors.js';

/**
 * ConversationService (FR-026 · FR-027)
 *
 * 정의 원본: DES-004 v2.2 §14·§18 · §전체 함수 시그니처 요약 (Services)
 * DB 스키마: DES-003 v2.1 §3
 *
 * 레이어 규칙(src/CLAUDE.md §레이어 규칙): Service는 Repository만 호출한다.
 */

/** msgType → senderRole 고정 매핑 (DES-009 §메시지 유형 · DES-013 §3-2) */
const MSG_TYPE_SENDER_ROLE: Record<string, string> = {
  [MessageType.CEO_UTTERANCE]: SenderRole.CEO,
  [MessageType.MAIN_RESPONSE]: SenderRole.MAIN,
  [MessageType.AGENT_REPORT]: SenderRole.AGENT,
  [MessageType.DECISION_REQUEST]: SenderRole.AGENT,
  [MessageType.SYSTEM_EVENT]: SenderRole.SYSTEM,
  [MessageType.ARTIFACT_LINK]: SenderRole.AGENT,
};

/** entity_snapshot 저장 형식 (DES-003 §3-1) — snake_case JSON */
interface StoredEntitySnapshot {
  agent_name: string;
  project_name: string;
  agent_type: string;
}

function snapshotToJson(snapshot: EntitySnapshot): string {
  const stored: StoredEntitySnapshot = {
    agent_name: snapshot.agentName,
    project_name: snapshot.projectName,
    agent_type: snapshot.agentType,
  };
  return JSON.stringify(stored);
}

function snapshotFromJson(json: string): EntitySnapshot {
  const stored = JSON.parse(json) as StoredEntitySnapshot;
  return {
    agentName: stored.agent_name,
    projectName: stored.project_name,
    agentType: stored.agent_type,
  };
}

/** structured 저장 형식 (DES-003 §3-2) — CLAUDE.md 보고 형식 4단, snake_case JSON */
interface StoredStructuredReport {
  summary: string;
  work_done: string;
  artifacts: string[];
  open_issues: string;
}

function structuredToJson(report: StructuredReport): string {
  const stored: StoredStructuredReport = {
    summary: report.summary,
    work_done: report.workDone,
    artifacts: report.artifacts,
    open_issues: report.openIssues,
  };
  return JSON.stringify(stored);
}

function structuredFromJson(json: string): StructuredReport {
  const stored = JSON.parse(json) as StoredStructuredReport;
  return {
    summary: stored.summary,
    workDone: stored.work_done,
    artifacts: stored.artifacts,
    openIssues: stored.open_issues,
  };
}

/** title 파생에 필요한 최소 필드 — ConversationWithAgentRow·SearchRow가 구조적으로 만족한다 */
interface TitleSource {
  channel_type: string;
  status: string;
  entity_snapshot: string | null;
  agent_name: string | null;
}

/**
 * title은 저장 값이 아니다 (DES-002 §4).
 * main 채널은 고정 'Main', 아카이브 채널은 entity_snapshot, 그 외는 agents 조인.
 * Agent가 삭제되어도(D-27) entity_snapshot이 있으므로 이름이 나온다.
 */
function deriveTitle(row: TitleSource): string {
  if (row.channel_type === ChannelType.MAIN) return 'Main';
  if (row.status === ConversationStatus.ARCHIVED && row.entity_snapshot) {
    return snapshotFromJson(row.entity_snapshot).agentName;
  }
  // active/readonly인데 agent 조인이 비면 비정상 상태다 — 방어적으로 폴백한다
  return row.agent_name ?? '알 수 없음';
}

/** toConversation이 요구하는 최소 필드 — 순수 ConversationRow에 agent_name만 더하면 된다 */
type ConversationForDisplay = ConversationRow & { agent_name: string | null };

function toConversation(row: ConversationForDisplay, lastMessageAt: string | null): Conversation {
  return {
    id: row.id,
    channelType: row.channel_type as Conversation['channelType'],
    entityId: row.entity_id,
    status: row.status as Conversation['status'],
    entitySnapshot: row.entity_snapshot ? snapshotFromJson(row.entity_snapshot) : null,
    title: deriveTitle(row),
    // ⚠ 임시 조치 — 읽음 상태를 저장하는 컬럼이 스키마에 없다(마이그레이션은 쓰기 금지 경로).
    // 파생할 원본이 없어 항상 0을 반환한다. 대표 결정 대기 중 (위임 지시사항 참조).
    unreadCount: 0,
    lastMessageAt,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    msgType: row.msg_type as Message['msgType'],
    senderRole: row.sender_role as Message['senderRole'],
    body: row.body,
    structured: row.structured ? structuredFromJson(row.structured) : null,
    approvalId: row.approval_id,
    createdAt: row.created_at,
  };
}

function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), 'utf-8').toString(
    'base64',
  );
}

function decodeCursor(cursor: string): { createdAt: string; id: string } {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as {
      createdAt?: unknown;
      id?: unknown;
    };
    if (typeof decoded.createdAt !== 'string' || typeof decoded.id !== 'string') {
      throw new Error('malformed cursor');
    }
    return { createdAt: decoded.createdAt, id: decoded.id };
  } catch {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, '커서 형식이 올바르지 않습니다');
  }
}

export class ConversationService {
  constructor(
    private readonly conversationRepo: ConversationRepository,
    private readonly messageRepo: MessageRepository,
  ) {}

  /** FR-026 — 채널 목록 + 필터. 페이지네이션 없음(DES-004 시그니처: Conversation[]) */
  async list(opts: ListConversationsOpts): Promise<Conversation[]> {
    const rows = this.conversationRepo.findMany({
      type: opts.type,
      status: opts.status ?? ConversationStatus.ACTIVE,
      projectId: opts.project,
      from: opts.from,
      to: opts.to,
    });

    return rows.map((row) => {
      const latest = this.messageRepo.findLatest(row.id);
      return toConversation(row, latest?.created_at ?? null);
    });
  }

  async getById(id: string): Promise<Conversation> {
    const row = this.conversationRepo.findByIdWithAgent(id);
    if (!row) {
      throw new AppError(
        404,
        ErrorCode.CONVERSATION_NOT_FOUND,
        `대화 채널을 찾을 수 없습니다: ${id}`,
      );
    }
    const latest = this.messageRepo.findLatest(id);
    return toConversation(row, latest?.created_at ?? null);
  }

  /** FR-027 — 커서 페이지네이션. limit+1건을 조회해 초과분 유무로 hasMore를 판정한다 (DES-004 §14) */
  async listMessages(convId: string, opts: ListMessagesOpts): Promise<CursorResponse<Message>> {
    const conv = this.conversationRepo.findById(convId);
    if (!conv) {
      throw new AppError(
        404,
        ErrorCode.CONVERSATION_NOT_FOUND,
        `대화 채널을 찾을 수 없습니다: ${convId}`,
      );
    }

    const limit = opts.limit ?? 50;
    const direction = opts.direction ?? 'before';
    const cursor = opts.cursor ? decodeCursor(opts.cursor) : null;

    const rows = this.messageRepo.listByCursor(convId, cursor, direction, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const boundary = page[page.length - 1];

    return {
      data: page.map(toMessage),
      cursor: {
        next: hasMore && boundary ? encodeCursor(boundary) : null,
        hasMore,
      },
    };
  }

  /** FR-027 — msgType·senderRole은 서버가 고정한다 (항상 MSG-01 / ceo) */
  async sendMessage(convId: string, input: SendMessageInput): Promise<Message> {
    const conv = this.conversationRepo.findById(convId);
    if (!conv) {
      throw new AppError(
        404,
        ErrorCode.CONVERSATION_NOT_FOUND,
        `대화 채널을 찾을 수 없습니다: ${convId}`,
      );
    }
    if (conv.status !== ConversationStatus.ACTIVE) {
      throw new AppError(
        409,
        ErrorCode.CONVERSATION_ARCHIVED,
        `읽기 전용 채널입니다 (상태: ${conv.status})`,
      );
    }

    const row = this.messageRepo.insert({
      id: crypto.randomUUID(),
      conversationId: convId,
      msgType: MessageType.CEO_UTTERANCE,
      senderRole: SenderRole.CEO,
      body: input.body,
      structured: null,
      createdAt: new Date().toISOString(),
    });

    return toMessage(row);
  }

  /** FR-027 — FTS5 전문 검색. 채널이 아카이브돼도 검색은 허용된다 */
  async search(opts: SearchMessagesOpts): Promise<SearchResult[]> {
    const rows: SearchRow[] = this.messageRepo.search({
      q: opts.q,
      type: opts.type,
      status: opts.status,
      from: opts.from,
      to: opts.to,
      limit: opts.limit ?? 20,
    });

    return rows.map((row) => ({
      messageId: row.id,
      conversationId: row.conversation_id,
      conversationTitle: deriveTitle(row),
      snippet: row.snippet,
      createdAt: row.created_at,
    }));
  }

  /** FR-027 — 마크다운 내보내기. 유일하게 응답 봉투({data:...})를 쓰지 않는다 (Route가 처리) */
  async exportMarkdown(convId: string): Promise<string> {
    const row = this.conversationRepo.findByIdWithAgent(convId);
    if (!row) {
      throw new AppError(
        404,
        ErrorCode.CONVERSATION_NOT_FOUND,
        `대화 채널을 찾을 수 없습니다: ${convId}`,
      );
    }

    const title = deriveTitle(row);
    const messages = this.messageRepo.listAll(convId);

    const lines = [`# ${title}`, ''];
    for (const m of messages) {
      lines.push(`## ${m.created_at} · ${m.sender_role} · ${m.msg_type}`);
      lines.push('');
      lines.push(m.body);
      lines.push('');
    }
    return lines.join('\n');
  }

  /** 시스템 발화 — Agent·Main·스케줄러가 쓴다. senderRole은 msgType에서 고정 매핑된다 */
  async appendSystemMessage(
    convId: string,
    msgType: Message['msgType'],
    body: string,
    structured?: StructuredReport,
  ): Promise<Message> {
    const conv = this.conversationRepo.findById(convId);
    if (!conv) {
      throw new AppError(
        404,
        ErrorCode.CONVERSATION_NOT_FOUND,
        `대화 채널을 찾을 수 없습니다: ${convId}`,
      );
    }

    const row = this.messageRepo.insert({
      id: crypto.randomUUID(),
      conversationId: convId,
      msgType,
      senderRole: MSG_TYPE_SENDER_ROLE[msgType] ?? SenderRole.SYSTEM,
      body,
      structured: structured ? structuredToJson(structured) : null,
      createdAt: new Date().toISOString(),
    });

    return toMessage(row);
  }

  /** Agent 생성 시 CH-AGENT 개설 (D-09). Route가 Agent 생성 트랜잭션 안에서 호출한다 (DES-004 §7) */
  async createForAgent(agentId: string): Promise<Conversation> {
    const id = crypto.randomUUID();
    this.conversationRepo.insert({
      id,
      channelType: ChannelType.AGENT,
      entityId: agentId,
      status: ConversationStatus.ACTIVE,
      createdAt: new Date().toISOString(),
    });

    const row = this.conversationRepo.findByIdWithAgent(id) as ConversationWithAgentRow;
    return toConversation(row, null);
  }

  /** Agent 종료(completed/cancelled) 시 CH-AGENT를 readonly로 전환한다 (DES-007 v2 §8) */
  async markReadonly(agentId: string): Promise<void> {
    const conv = this.conversationRepo.findByEntityId(agentId);
    // 채널이 없으면 조용히 반환한다 — D-09에 따라 Agent 생성 시 항상 개설되지만,
    // 존재하지 않는 채널을 전이시키려 하지 않는 방어적 처리다.
    if (!conv) return;
    this.conversationRepo.updateStatus(conv.id, ConversationStatus.READONLY);
  }

  /** Agent 삭제 시 대화를 보존하고 아카이브로 전환한다 (D-27) */
  async archiveByEntity(agentId: string, snapshot: EntitySnapshot): Promise<string> {
    const conv = this.conversationRepo.findByEntityId(agentId);
    if (!conv) {
      throw new AppError(
        404,
        ErrorCode.CONVERSATION_NOT_FOUND,
        `Agent의 대화 채널을 찾을 수 없습니다: ${agentId}`,
      );
    }
    this.conversationRepo.archiveWithSnapshot(
      conv.id,
      snapshotToJson(snapshot),
      new Date().toISOString(),
    );
    return conv.id;
  }

  /** 부트스트랩 — CH-MAIN 멱등 생성 (v2.1 · R-01) */
  async ensureMainChannel(): Promise<Conversation> {
    const existing = this.conversationRepo.findMainChannel();
    const row =
      existing ??
      this.conversationRepo.insert({
        id: crypto.randomUUID(),
        channelType: ChannelType.MAIN,
        entityId: null,
        status: ConversationStatus.ACTIVE,
        createdAt: new Date().toISOString(),
      });

    return toConversation({ ...row, agent_name: null }, null);
  }
}
