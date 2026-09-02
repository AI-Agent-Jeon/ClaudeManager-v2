import { writeFile } from 'node:fs/promises';
import { isAbsolute, resolve as resolvePath, sep } from 'node:path';
import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import {
  AgentStatus,
  ChannelType,
  ConversationStatus,
  ErrorCode,
  MessageType,
  WaitingReason,
} from '../../shared/constants.js';
import type {
  AgentDetail,
  Conversation,
  CursorResponse,
  Message,
  SearchResult,
} from '../../shared/types.js';
import { ApiClient, ApiRequestError, ServerUnreachableError } from '../api-client.js';
import { loadAuth } from '../config.js';
import {
  dim,
  formatFields,
  formatTimestamp,
  highlightMark,
  ID_SHORT_LEN,
  NAME_MAX_LEN,
  renderTable,
  shortId,
  successBlock,
  totalFooter,
  truncateName,
} from '../output.js';
import {
  ambiguousIdBlock,
  type CliApiClient,
  type CommandDeps,
  checkAuth,
  defaultCommandDeps,
  mapCommonApiError,
  notFoundBlock,
  presentAuthGuardFailure,
  serverUnreachableBlock,
  unauthenticatedBlock,
} from '../runtime.js';
import { runAgentDetail } from './agent.js';

/**
 * `cm chat main/agent/send/list/log/search` — SCR-CH01~03·11~13
 *
 * 정의 원본: DES-006 v3.2 §2 SCR-CH01~03·11~13 · §3-1 표시 데이터 ·
 * §4-5 EVT-CH01~03·11~13 · DES-013 §3(메시지 체계)·§5(CLI 대응) ·
 * DES-002 v2.4 §3-2·§4(대화 엔드포인트)
 *
 * `commands/project.ts`·`agent.ts`(그룹 A)와 같은 관용구를 쓴다: 판정 로직
 * (run*)은 콘솔에 쓰지 않고 판별 유니온만 돌려주고, `present*`가 §8 출력
 * 형식으로 바꾼다. Agent 채널 해석은 `agent.ts`의 `runAgentDetail`을 그대로
 * 재사용한다 — `AgentDetail.conversationId`가 이미 그 Agent의 CH-AGENT id를
 * 담고 있어(D-27), 대화 채널을 따로 목록 조회해 entityId로 매칭할 필요가
 * 없다.
 *
 * **REPL(SCR-CH01·CH02)은 이 그룹의 첫 장기 실행 세션이다.** 종료 경로는
 * `/exit` 입력과 Ctrl+C(SIGINT)·Ctrl+D(EOF) 셋 다 같은 결과로 수렴한다
 * (`createDefaultReadLine`). 비대화형 환경(TTY 아님)에서는 REPL을 아예
 * 띄우지 않는다 — `auth.ts`의 `NOT_TTY` 판단과 같은 원칙이다. 실시간 수신
 * (WS)은 Phase 1 범위 밖이다(개발 지시 §2(1)) — REPL은 최근 20건을 보여주고
 * 전송·전송 확인까지만 한다.
 */

const CHANNEL_TYPE_VALUES = Object.values(ChannelType);
const CONVERSATION_STATUS_VALUES = Object.values(ConversationStatus);

/** `crypto.randomUUID()` 형식의 전체 길이 — `runtime.ts`의 `FULL_ID_LEN`과 같은 값.
 *  `resolveId`(runtime.ts)는 `res.pagination.totalPages`를 요구하는데
 *  `GET /api/conversations`는 페이지네이션 없이 배열만 돌려준다(위 헤더 설명).
 *  그래서 대화 채널 ID 해석은 여기 별도로 둔다 — `runtime.ts`를 페이지네이션
 *  없는 리소스까지 억지로 지원하도록 넓히면 project·agent·task의 기존 계약이
 *  흔들린다. */
const FULL_ID_LEN = 36;

// ─────────────────────────────────────────────
// 표시 헬퍼 — 발신자·대기 사유 라벨 (DES-013 §3-1 · DES-006 §3-1)
// ─────────────────────────────────────────────

const SENDER_LABEL: Record<string, string> = {
  ceo: '대표',
  main: 'Main',
  agent: 'Agent',
  system: '시스템',
};

function senderLabel(role: string): string {
  return SENDER_LABEL[role] ?? role;
}

const WAITING_REASON_LABEL: Record<string, string> = {
  [WaitingReason.CEO_APPROVAL]: '대표 승인 대기',
  [WaitingReason.CEO_DECISION]: '대표 결정 대기',
  [WaitingReason.EXTERNAL_INPUT]: '외부 입력 대기',
};

/**
 * CH-AGENT가 `readonly`인지 여부 — Agent 상세 응답엔 채널 상태 필드가 없다
 * (`AgentDetail.conversationId`는 id만). 목록 API로 한 번 더 조회하는 대신,
 * `agent.service.ts`(DES-007 v2 §8)의 확정된 전이 규칙 "Agent →
 * completed/cancelled ⇒ CH-AGENT readonly"를 그대로 판정에 쓴다 — Agent가
 * 여기서 조회됐다는 것 자체가 삭제(archived)되지 않았다는 뜻이므로 남는
 * 경우는 active/readonly 둘뿐이다.
 */
function isAgentChannelReadonly(agentStatus: string): boolean {
  return agentStatus === AgentStatus.COMPLETED || agentStatus === AgentStatus.CANCELLED;
}

// ─────────────────────────────────────────────
// 메시지 렌더링 — MSG-01~06 (DES-013 §3-1·3-2·3-3, DES-006 §3-1)
// ─────────────────────────────────────────────

/** REPL 초기 로드(SCR-CH01·CH02) — MSG-03은 4단 접기, MSG-05는 dim 1행 */
function renderMessageCollapsed(m: Message): string {
  const time = formatTimestamp(m.createdAt);
  const sender = senderLabel(m.senderRole);

  if (m.msgType === MessageType.SYSTEM_EVENT) {
    return dim(`  · ${time} ${m.body}`);
  }
  if (m.msgType === MessageType.DECISION_REQUEST) {
    return renderDecisionCard(m, time);
  }
  if (m.msgType === MessageType.AGENT_REPORT && m.structured) {
    return (
      `  [${sender}] ${time} (${m.msgType})\n` +
      `    ${m.structured.summary}\n` +
      `    ▾ 수행 내용 · ▾ 산출물 · ▾ 미해결 사항 (cm chat log로 전체 보기)`
    );
  }
  return `  [${sender}] ${time} (${m.msgType})\n    ${m.body}`;
}

/** `cm chat log`(SCR-CH12) — MSG-03은 4단 전개 */
function renderMessageExpanded(m: Message): string {
  const time = formatTimestamp(m.createdAt);
  const sender = senderLabel(m.senderRole);
  const header = `  ${time} · ${sender} · ${m.msgType}`;

  if (m.msgType === MessageType.AGENT_REPORT && m.structured) {
    const s = m.structured;
    return [
      header,
      `    요약: ${s.summary}`,
      `    수행 내용: ${s.workDone}`,
      `    산출물: ${s.artifacts.length > 0 ? s.artifacts.join(', ') : '없음'}`,
      `    미해결 사항: ${s.openIssues || '없음'}`,
    ].join('\n');
  }
  if (m.msgType === MessageType.DECISION_REQUEST) {
    return `${header}\n${decisionCardBody(m)}`;
  }
  return `${header}\n    ${m.body}`;
}

/** MSG-04 — "그냥 흘러가면 안 되는" 메시지라 ⚠ 카드로 강조한다 (EVT-CH01-4) */
function renderDecisionCard(m: Message, time: string): string {
  return `  ⚠ 의사결정 요청 · ${time}\n${decisionCardBody(m)}`;
}

function decisionCardBody(m: Message): string {
  const lines = [`    ${m.body}`];
  if (m.approvalId) {
    const id = shortId(m.approvalId);
    lines.push(`    승인ID: ${id} · cm decide ${id} --approve | --reject --reason "<사유>"`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// 메시지 조회 헬퍼 — 커서 페이지네이션 (DES-002 §4 · 개발 지시 §2(2))
// ─────────────────────────────────────────────

/** REPL 최초 진입 — 최근 20건(EVT-CH01-1·CH02-1), 오래된 순으로 뒤집어 보여준다 */
async function fetchRecentMessages(
  client: CliApiClient,
  conversationId: string,
  limit = 20,
): Promise<Message[]> {
  const res = await client.get<CursorResponse<Message>>(
    `/conversations/${conversationId}/messages?limit=${limit}`,
  );
  return [...res.data].reverse();
}

/**
 * 전체 메시지를 시간순(오래된 → 최신)으로 모은다 — `cm chat log`(SCR-CH12
 * "전체 메시지 시간순")와 읽기 전용 Agent 채널의 "전체 로그"(EVT-CH02-2)가
 * 쓴다. 각 페이지는 `created_at DESC`이고 다음 페이지는 그보다 더 과거를
 * 담으므로, 전체를 이어 붙인 배열 자체가 이미 최신→과거 순으로 정렬돼
 * 있다 — 마지막에 한 번만 뒤집으면 된다(페이지마다 뒤집지 않는다).
 */
async function fetchAllMessagesChronological(
  client: CliApiClient,
  conversationId: string,
): Promise<Message[]> {
  const collected: Message[] = [];
  let cursor: string | undefined;
  for (;;) {
    const qs = new URLSearchParams({ limit: '100' });
    if (cursor) qs.set('cursor', cursor);
    const res = await client.get<CursorResponse<Message>>(
      `/conversations/${conversationId}/messages?${qs.toString()}`,
    );
    collected.push(...res.data);
    if (!res.cursor.hasMore || !res.cursor.next) break;
    cursor = res.cursor.next;
  }
  return collected.reverse();
}

// ─────────────────────────────────────────────
// 채널 ID 해석 — `cm chat log`·`cm chat send` (§8 ID 축약 규칙)
// ─────────────────────────────────────────────

export type ConversationLookupResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> };

/**
 * `GET /api/conversations`는 단건 조회(`GET /:id`)가 없고, `status` 필터
 * 기본값이 `active`뿐이라(DES-002 §4) 상태 3종을 각각 조회해 합친다.
 * 채널 개수가 Phase 1 규모(Main 1 + Agent 수)라 3회 조회 비용은 무시할
 * 만하다.
 */
export async function resolveConversationId(
  client: CliApiClient,
  idOrPrefix: string,
): Promise<ConversationLookupResult> {
  const candidates: Conversation[] = [];
  for (const status of CONVERSATION_STATUS_VALUES) {
    const res = await client.get<{ data: Conversation[] }>(`/conversations?status=${status}`);
    for (const c of res.data) {
      if (c.id === idOrPrefix || (idOrPrefix.length < FULL_ID_LEN && c.id.startsWith(idOrPrefix))) {
        candidates.push(c);
      }
    }
  }

  if (candidates.length === 0) return { ok: false, reason: 'not_found' };
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      candidates: candidates.map((c) => ({ id: c.id, label: c.title })),
    };
  }
  return { ok: true, conversation: candidates[0] as Conversation };
}

// ─────────────────────────────────────────────
// main — SCR-CH01 (REPL)
// ─────────────────────────────────────────────

export type ChatMainOpenResult =
  | { ok: true; conversation: Conversation; messages: Message[] }
  | { ok: false; reason: 'conversation_not_found' }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runChatMainOpen(opts: { client: CliApiClient }): Promise<ChatMainOpenResult> {
  try {
    // CH-MAIN 주소 지정 규약(DES-002 §4) — `?type=main`으로 id를 먼저 얻는다.
    const listRes = await opts.client.get<{ data: Conversation[] }>('/conversations?type=main');
    const conversation = listRes.data[0];
    if (!conversation) return { ok: false, reason: 'conversation_not_found' };

    // 읽음 포인터 갱신(ConversationService.markRead, DEV-D-05)은 여기서 호출해야
    // 하지만 `conversations.routes.ts`에 이를 노출하는 HTTP 경로가 없다(REST
    // 5종에 markRead 없음 — routes 파일 실사 확인). 백엔드는 완결 범위라 CLI가
    // 라우트를 새로 만들 수 없어 이 호출은 생략한다. 미해결 사항으로 보고한다.
    const messages = await fetchRecentMessages(opts.client, conversation.id);
    return { ok: true, conversation, messages };
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
}

// ─────────────────────────────────────────────
// agent — SCR-CH02 (REPL 또는 읽기 전용 로그)
// ─────────────────────────────────────────────

export type ChatAgentOpenResult =
  | { ok: true; agent: AgentDetail; messages: Message[]; readonly: boolean }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'no_conversation'; agentId: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runChatAgentOpen(opts: {
  client: CliApiClient;
  idOrPrefix: string;
}): Promise<ChatAgentOpenResult> {
  const detail = await runAgentDetail({ client: opts.client, idOrPrefix: opts.idOrPrefix });
  if (!detail.ok) return detail;

  const agent = detail.agent;
  if (!agent.conversationId) {
    // D-09에 따라 Agent 생성 트랜잭션이 항상 CH-AGENT를 만든다 — 정상 경로에선
    // 발생하지 않는다. 방어적으로만 다룬다.
    return { ok: false, reason: 'no_conversation', agentId: agent.id };
  }

  // REV-H-04 — `runChatMainOpen`(위)은 같은 메시지 조회를 try로 감쌌는데
  // 여기만 빠져 있었다. Agent 조회 성공 후 서버가 끊기면 선언된
  // `server_unreachable` 분기 대신 generic 에러로 uncaught 전파됐다.
  try {
    const readonly = isAgentChannelReadonly(agent.status);
    const messages = readonly
      ? await fetchAllMessagesChronological(opts.client, agent.conversationId)
      : await fetchRecentMessages(opts.client, agent.conversationId);

    return { ok: true, agent, messages, readonly };
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
}

// ─────────────────────────────────────────────
// REPL 구동 — /exit · Ctrl+C · Ctrl+D 셋 다 종료로 수렴한다
// ─────────────────────────────────────────────

export interface ChatReplDeps {
  client: CliApiClient;
  conversationId: string;
  readLine: (prompt: string) => Promise<string | null>;
  log: (msg: string) => void;
  errorLog: (msg: string) => void;
}

type ReplSendOutcome = 'sent' | 'archived' | 'error';

/** 전송 1건의 성공·실패 처리 — 루프 본문에서 분기를 걷어내 인지 복잡도를 낮춘다 */
async function sendReplMessage(deps: ChatReplDeps, body: string): Promise<ReplSendOutcome> {
  try {
    const res = await deps.client.post<{ data: Message }>(
      `/conversations/${deps.conversationId}/messages`,
      { body },
    );
    deps.log(`                                    [대표] ${formatTimestamp(res.data.createdAt)}`);
    deps.log(`  ${body}`);
    return 'sent';
  } catch (err) {
    if (err instanceof ServerUnreachableError) {
      deps.errorLog(serverUnreachableBlock(deps.client.baseUrl));
      return 'error';
    }
    if (err instanceof ApiRequestError && err.code === ErrorCode.CONVERSATION_ARCHIVED) {
      deps.errorLog('✗ 종료된 채널에는 보낼 수 없습니다');
      return 'archived';
    }
    if (err instanceof ApiRequestError) {
      deps.errorLog(`✗ 전송 실패: ${err.message}`);
      return 'error';
    }
    throw err;
  }
}

/** readLine이 `null`을 돌려주면(Ctrl+C·Ctrl+D) 또는 `/exit` 입력 시 종료한다 */
export async function runChatRepl(deps: ChatReplDeps): Promise<{ sentCount: number }> {
  let sentCount = 0;
  for (;;) {
    const line = await deps.readLine('> ');
    if (line === null) break;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed === '/exit') break;

    const outcome = await sendReplMessage(deps, trimmed);
    if (outcome === 'sent') sentCount += 1;
    if (outcome === 'archived') break;
  }
  return { sentCount };
}

/**
 * 한 세션 동안 재사용하는 readline 인터페이스를 감싼다. `question()`을
 * 반복 호출하는 표준 REPL 관용구를 쓰되(`runtime.ts`의 `defaultPromptConfirm`
 * 과 달리 매번 새 인터페이스를 만들지 않는다), SIGINT(Ctrl+C)·close(Ctrl+D)
 * 둘 다 "세션 종료"로 일원화한다 — 대표가 REPL에서 못 빠져나가는 상태를
 * 만들지 않는다(개발 지시 §2(1)).
 */
export function createDefaultReadLine(): {
  readLine: (prompt: string) => Promise<string | null>;
  close: () => void;
} {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const readLine = (prompt: string): Promise<string | null> =>
    new Promise((resolve) => {
      const cleanup = () => {
        rl.off('SIGINT', onSigint);
        rl.off('close', onClose);
      };
      const onSigint = () => {
        cleanup();
        resolve(null);
      };
      const onClose = () => {
        cleanup();
        resolve(null);
      };
      rl.question(prompt, (answer) => {
        cleanup();
        resolve(answer);
      });
      rl.once('SIGINT', onSigint);
      rl.once('close', onClose);
    });

  return { readLine, close: () => rl.close() };
}

// ─────────────────────────────────────────────
// send — SCR-CH03 (비대화형 1회 전송)
// ─────────────────────────────────────────────

export type ChatSendResult =
  | { ok: true; message: Message; conversationTitle: string }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'conversation_archived' }
  | { ok: false; reason: 'conversation_not_found' }
  | { ok: false; reason: 'validation'; message: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

type SendTargetResult =
  | { ok: true; conversationId: string; conversationTitle: string }
  | Exclude<ChatSendResult, { ok: true }>;

/**
 * 인증·서버 unreachable 공통 매핑 — `resolveSendTarget`·`runChatSend` 둘 다 쓴다.
 * REV-L-07 — `runtime.ts`의 `mapCommonApiError`(REV-H-03 도입)와 완전히 같은
 * 모양이라 그 헬퍼에 위임한다.
 */
function mapChatAuthError(
  err: unknown,
  client: CliApiClient,
): Exclude<ChatSendResult, { ok: true }> {
  return mapCommonApiError(err, client);
}

/**
 * `<채널>` 인자 해석 — 리터럴 `main` 또는 Agent ID(전체·앞 8자리).
 * DES-013 §5 예시가 `main`을 그대로 쓴다. `runChatSend`에서 이 부분을
 * 떼어내 인지 복잡도를 낮춘다(Biome `noExcessiveCognitiveComplexity`).
 */
async function resolveSendTarget(client: CliApiClient, channel: string): Promise<SendTargetResult> {
  if (channel.trim().toLowerCase() === ChannelType.MAIN) {
    try {
      const res = await client.get<{ data: Conversation[] }>('/conversations?type=main');
      const conv = res.data[0];
      if (!conv) return { ok: false, reason: 'conversation_not_found' };
      return { ok: true, conversationId: conv.id, conversationTitle: conv.title };
    } catch (err) {
      return mapChatAuthError(err, client);
    }
  }

  const agentResult = await runAgentDetail({ client, idOrPrefix: channel });
  if (!agentResult.ok) return agentResult;
  if (!agentResult.agent.conversationId) return { ok: false, reason: 'conversation_not_found' };
  return {
    ok: true,
    conversationId: agentResult.agent.conversationId,
    conversationTitle: agentResult.agent.name,
  };
}

export async function runChatSend(opts: {
  client: CliApiClient;
  channel: string;
  body: string;
}): Promise<ChatSendResult> {
  const target = await resolveSendTarget(opts.client, opts.channel);
  if (!target.ok) return target;

  try {
    const res = await opts.client.post<{ data: Message }>(
      `/conversations/${target.conversationId}/messages`,
      { body: opts.body },
    );
    return { ok: true, message: res.data, conversationTitle: target.conversationTitle };
  } catch (err) {
    if (err instanceof ApiRequestError) {
      if (err.code === ErrorCode.CONVERSATION_ARCHIVED) {
        return { ok: false, reason: 'conversation_archived' };
      }
      if (err.code === ErrorCode.CONVERSATION_NOT_FOUND) {
        return { ok: false, reason: 'conversation_not_found' };
      }
      if (err.code === ErrorCode.VALIDATION_ERROR) {
        return { ok: false, reason: 'validation', message: err.message };
      }
    }
    return mapChatAuthError(err, opts.client);
  }
}

function presentChatSend(result: ChatSendResult, deps: CommandDeps): void {
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        deps.errorLog(notFoundBlock('Agent', result.id, 'cm agent list'));
        break;
      case 'ambiguous':
        deps.errorLog(ambiguousIdBlock(result.candidates));
        break;
      case 'conversation_archived':
        deps.errorLog('✗ 종료된 채널에는 보낼 수 없습니다');
        break;
      case 'conversation_not_found':
        deps.errorLog('✗ 대화 채널을 찾을 수 없습니다');
        break;
      case 'validation':
        deps.errorLog(`✗ ${result.message}`);
        break;
      case 'server_unreachable':
        deps.errorLog(serverUnreachableBlock(result.serverUrl));
        break;
      case 'unauthenticated':
        deps.errorLog(unauthenticatedBlock(false));
        break;
    }
    deps.setExitCode(1);
    return;
  }

  deps.log(
    successBlock(
      '전송 완료',
      formatFields([
        ['채널', result.conversationTitle],
        ['메시지 ID', shortId(result.message.id)],
        ['전송 시각', formatTimestamp(result.message.createdAt)],
      ]),
    ),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// list — SCR-CH11
// ─────────────────────────────────────────────

export type ChatListResult =
  | { ok: true; items: Conversation[]; type?: string; status?: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runChatList(opts: {
  client: CliApiClient;
  type?: string;
  status?: string;
}): Promise<ChatListResult> {
  try {
    const qs = new URLSearchParams();
    if (opts.type) qs.set('type', opts.type);
    if (opts.status) qs.set('status', opts.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await opts.client.get<{ data: Conversation[] }>(`/conversations${suffix}`);
    return { ok: true, items: res.data, type: opts.type, status: opts.status };
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
}

/** 아카이브 채널은 제목 뒤 "(삭제됨)" — `entitySnapshot.agentName` 기반 title은 서버가 이미 채운다(DES-002 §4) */
function conversationCells(c: Conversation): string[] {
  const title = c.status === ConversationStatus.ARCHIVED ? `${c.title} (삭제됨)` : c.title;
  return [
    shortId(c.id),
    c.channelType,
    truncateName(title),
    c.status,
    String(c.unreadCount),
    c.lastMessageAt ? formatTimestamp(c.lastMessageAt) : '-',
  ];
}

/**
 * `output.ts`의 `renderTable`을 그대로 쓴다(개발 지시 §3 — CLI에서 표 렌더링을
 * 새로 만들지 마라). 아카이브 행에만 `dim()`을 적용해야 해서(EVT-CH11-1),
 * 셀 단위로 감싸는 대신 **먼저 표를 통째로 렌더링한 뒤 해당 줄만 감싼다** —
 * ANSI 이스케이프를 셀 안에 먼저 넣으면 그 바이트 수까지 `padEnd`가 폭
 * 계산에 넣어버려 표가 깨진다(실사용 검증에서 발견 — §완료 판정 기준 5).
 */
function presentChatList(result: ChatListResult, deps: CommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'server_unreachable')
      deps.errorLog(serverUnreachableBlock(result.serverUrl));
    else deps.errorLog(unauthenticatedBlock(false));
    deps.setExitCode(1);
    return;
  }

  if (result.items.length === 0) {
    deps.log(successBlock('대화 채널 목록', '대화 채널이 없습니다'));
    deps.setExitCode(0);
    return;
  }

  const headers = ['ID', '종류', '제목', '상태', '미읽음', '최근 메시지'];
  const minWidths = [ID_SHORT_LEN, 5, NAME_MAX_LEN, 10, 6, 19];
  const tableLines = renderTable(headers, result.items.map(conversationCells), minWidths).split(
    '\n',
  );
  const table = tableLines
    .map((line, i) => {
      const item = result.items[i - 2]; // 0=헤더, 1=구분선, 2부터 본문(rows와 같은 순서)
      return item?.status === ConversationStatus.ARCHIVED ? dim(line) : line;
    })
    .join('\n');

  const filters = [result.type, result.status].filter((v): v is string => Boolean(v));
  deps.log(
    successBlock('대화 채널 목록', `${table}\n\n${totalFooter(result.items.length, filters)}`),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// log — SCR-CH12 (본문 출력 · --export 마크다운 내보내기)
// ─────────────────────────────────────────────

export type ChatLogResult =
  | { ok: true; conversation: Conversation; messages: Message[]; since?: string }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'invalid_since'; value: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runChatLog(opts: {
  client: CliApiClient;
  idOrPrefix: string;
  since?: string;
}): Promise<ChatLogResult> {
  let sinceMs: number | undefined;
  if (opts.since !== undefined) {
    const parsed = new Date(opts.since).getTime();
    if (Number.isNaN(parsed)) return { ok: false, reason: 'invalid_since', value: opts.since };
    sinceMs = parsed;
  }

  try {
    const resolved = await resolveConversationId(opts.client, opts.idOrPrefix);
    if (!resolved.ok) {
      if (resolved.reason === 'not_found')
        return { ok: false, reason: 'not_found', id: opts.idOrPrefix };
      return resolved;
    }

    const all = await fetchAllMessagesChronological(opts.client, resolved.conversation.id);
    const messages =
      sinceMs === undefined
        ? all
        : all.filter((m) => new Date(m.createdAt).getTime() >= (sinceMs as number));

    return { ok: true, conversation: resolved.conversation, messages, since: opts.since };
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
}

function presentChatLog(result: ChatLogResult, deps: CommandDeps): void {
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        deps.errorLog(notFoundBlock('대화 채널', result.id, 'cm chat list'));
        break;
      case 'ambiguous':
        deps.errorLog(ambiguousIdBlock(result.candidates));
        break;
      case 'invalid_since':
        deps.errorLog(`✗ --since 값이 올바른 날짜가 아닙니다: ${result.value}`);
        break;
      case 'server_unreachable':
        deps.errorLog(serverUnreachableBlock(result.serverUrl));
        break;
      case 'unauthenticated':
        deps.errorLog(unauthenticatedBlock(false));
        break;
    }
    deps.setExitCode(1);
    return;
  }

  const header = formatFields([
    ['채널', result.conversation.title],
    ['조회 기간', result.since ? `${result.since} 이후` : '전체'],
  ]);

  const body =
    result.messages.length === 0
      ? '  메시지가 없습니다'
      : result.messages.map(renderMessageExpanded).join('\n\n');

  const filters = result.since ? [`--since ${result.since}`] : [];
  deps.log(
    successBlock(
      '대화 로그',
      `${header}\n\n${body}\n\n${totalFooter(result.messages.length, filters)}`,
    ),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// log --export — 마크다운 내보내기 (EVT-CH12-2)
// ─────────────────────────────────────────────

/** `ApiClient`(api-client.ts)가 실제로 구현한다. `send()`는 JSON 파싱을 시도해 마크다운 본문을 undefined로 삼킨다 */
interface ChatExportClient extends CliApiClient {
  getText(path: string): Promise<string>;
}

export type ChatExportResult =
  | { ok: true; savedPath: string }
  | { ok: false; reason: 'not_found'; id: string }
  | { ok: false; reason: 'ambiguous'; candidates: Array<{ id: string; label: string }> }
  | { ok: false; reason: 'escapes_cwd'; path: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

/**
 * 저장 경로·기본 파일명 (등급 낮음, 자율 판단).
 *
 * 기본 파일명은 `conversation-<채널ID 8자>-<YYYYMMDD-HHmmss>.md`로 CWD에
 * 저장한다. `--export <path>`로 상대 경로를 주면 CWD 기준으로 정규화하고,
 * 정규화 결과가 CWD 밖으로 벗어나면(`..` 상위 탈출) 거부한다 — Layer 2-9
 * `artifact.service.ts`의 `resolveSafeGitPath()`와 같은 원칙이다.
 * 다만 **절대 경로는 허용한다**: 그 함수는 서버가 DB에 저장된(잠재적으로
 * 신뢰할 수 없는) 상대 경로를 읽는 상황을 막는 것이지만, 여기는 대표가
 * 터미널에 직접 입력한 저장 위치라 위협 모델이 다르다 — 이미 자기
 * 파일시스템 전체에 쓰기 권한이 있는 로컬 CLI 사용자다. 스크립트·자동화
 * 상황에서 상대 경로의 `..`가 의도치 않게 CWD를 벗어나는 것만 방어한다.
 */
export function resolveExportPath(
  cwd: string,
  userPath: string | undefined,
  defaultName: string,
): { ok: true; path: string } | { ok: false; path: string } {
  if (!userPath) return { ok: true, path: resolvePath(cwd, defaultName) };

  // `cwd`를 먼저 정규화한다 — 호출부는 항상 `process.cwd()`(이미 OS 형식의
  // 절대 경로)를 넘기지만, 비교 기준 자체를 한 번 더 `resolvePath`에 태워야
  // 대소문자·구분자 표기가 다른 입력에서도 `startsWith` 비교가 안정적이다.
  const base = resolvePath(cwd);
  const looksLikeDir = userPath.endsWith('/') || userPath.endsWith('\\');
  const target = looksLikeDir
    ? resolvePath(base, userPath, defaultName)
    : resolvePath(base, userPath);

  if (!isAbsolute(userPath) && target !== base && !target.startsWith(base + sep)) {
    return { ok: false, path: target };
  }
  return { ok: true, path: target };
}

function defaultExportFilename(conversationId: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `conversation-${shortId(conversationId)}-${stamp}.md`;
}

export async function runChatExport(opts: {
  client: ChatExportClient;
  idOrPrefix: string;
  exportPath?: string;
  cwd: string;
  now: () => Date;
}): Promise<ChatExportResult> {
  try {
    const resolved = await resolveConversationId(opts.client, opts.idOrPrefix);
    if (!resolved.ok) {
      if (resolved.reason === 'not_found')
        return { ok: false, reason: 'not_found', id: opts.idOrPrefix };
      return resolved;
    }

    const target = resolveExportPath(
      opts.cwd,
      opts.exportPath,
      defaultExportFilename(resolved.conversation.id, opts.now()),
    );
    if (!target.ok) return { ok: false, reason: 'escapes_cwd', path: target.path };

    const markdown = await opts.client.getText(`/conversations/${resolved.conversation.id}/export`);
    await writeFile(target.path, markdown, 'utf-8');
    return { ok: true, savedPath: target.path };
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
}

function presentChatExport(result: ChatExportResult, deps: CommandDeps): void {
  if (!result.ok) {
    switch (result.reason) {
      case 'not_found':
        deps.errorLog(notFoundBlock('대화 채널', result.id, 'cm chat list'));
        break;
      case 'ambiguous':
        deps.errorLog(ambiguousIdBlock(result.candidates));
        break;
      case 'escapes_cwd':
        deps.errorLog(`✗ 저장 경로가 현재 디렉토리를 벗어납니다: ${result.path}`);
        break;
      case 'server_unreachable':
        deps.errorLog(serverUnreachableBlock(result.serverUrl));
        break;
      case 'unauthenticated':
        deps.errorLog(unauthenticatedBlock(false));
        break;
    }
    deps.setExitCode(1);
    return;
  }

  deps.log(successBlock('마크다운 내보내기 완료', `  저장 경로: ${result.savedPath}`));
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// search — SCR-CH13
// ─────────────────────────────────────────────

const MIN_SEARCH_QUERY_LEN = 2;

export type ChatSearchResult =
  | { ok: true; items: SearchResult[]; q: string }
  | { ok: false; reason: 'too_short'; q: string }
  | { ok: false; reason: 'server_unreachable'; serverUrl: string }
  | { ok: false; reason: 'unauthenticated' };

export async function runChatSearch(opts: {
  client: CliApiClient;
  q: string;
}): Promise<ChatSearchResult> {
  if (opts.q.length < MIN_SEARCH_QUERY_LEN) return { ok: false, reason: 'too_short', q: opts.q };

  try {
    const res = await opts.client.get<{ data: SearchResult[] }>(
      `/conversations/search?q=${encodeURIComponent(opts.q)}`,
    );
    return { ok: true, items: res.data, q: opts.q };
  } catch (err) {
    return mapCommonApiError(err, opts.client);
  }
}

/** DES-003 v2 §3-3 미해결 사항 — unicode61 토크나이저는 한국어 조사를 분리하지 못한다 */
const KOREAN_PARTICLE_WARNING =
  '⚠ 한국어 조사(을/를/이/가 등)가 붙은 단어는 검색에 걸리지 않을 수 있습니다';

function presentChatSearch(result: ChatSearchResult, deps: CommandDeps): void {
  if (!result.ok) {
    if (result.reason === 'too_short') {
      deps.errorLog('✗ 검색어는 2자 이상이어야 합니다');
    } else if (result.reason === 'server_unreachable') {
      deps.errorLog(serverUnreachableBlock(result.serverUrl));
    } else {
      deps.errorLog(unauthenticatedBlock(false));
    }
    deps.setExitCode(1);
    return;
  }

  if (result.items.length === 0) {
    deps.log(
      `${successBlock('검색 결과', `"${result.q}"에 대한 결과가 없습니다`)}\n\n  ${KOREAN_PARTICLE_WARNING}`,
    );
    deps.setExitCode(0);
    return;
  }

  // 고정폭 표로 만들지 않는다 — `snippet`은 `<mark>`를 ANSI로 바꾼 강조 텍스트라
  // 문자열 길이에 이스케이프 바이트가 섞여 `padEnd` 폭 계산이 어긋난다
  // (`chat list`에서 같은 종류의 정렬 깨짐을 실사용 검증 중 발견해 여기는
  // 처음부터 표 대신 행 블록으로 만든다).
  const blocks = result.items.map(
    (r) =>
      `  ${truncateName(r.conversationTitle)}  ·  ${formatTimestamp(r.createdAt)}  ·  ${shortId(r.messageId)}\n    ${highlightMark(r.snippet)}`,
  );

  deps.log(
    successBlock(
      '검색 결과',
      `${blocks.join('\n\n')}\n\n검색어: ${result.q} · ${totalFooter(result.items.length)}\n\n  ${KOREAN_PARTICLE_WARNING}`,
    ),
  );
  deps.setExitCode(0);
}

// ─────────────────────────────────────────────
// 채널 헤더 출력 (REPL 진입 시 공통)
// ─────────────────────────────────────────────

function printMessageHistory(deps: CommandDeps, messages: Message[]): void {
  if (messages.length === 0) {
    deps.log('  (표시할 메시지가 없습니다)');
    return;
  }
  for (const m of messages) deps.log(renderMessageCollapsed(m));
}

// ─────────────────────────────────────────────
// Commander 연결
// ─────────────────────────────────────────────

interface ChatCommandDeps extends CommandDeps {
  /** REPL 한 세션의 줄 입력원 — 테스트가 실제 TTY 없이 스크립트로 줄을 흘려보낼 수 있다 */
  createReadLine: () => { readLine: (prompt: string) => Promise<string | null>; close: () => void };
  /** `process.stdin.isTTY` 판정 — REPL은 비대화형 환경에서 아예 띄우지 않는다(개발 지시 §2(1)) */
  isInteractive: () => boolean;
  cwd: () => string;
}

function defaultChatCommandDeps(): ChatCommandDeps {
  const base = defaultCommandDeps();
  return {
    ...base,
    // `defaultCommandDeps().createClient`는 `CliApiClient`로 좁혀 반환하지만
    // 실제 값은 `getText()`도 가진 `ApiClient` 인스턴스다(api-client.ts) —
    // `--export`가 필요로 하는 형태로 다시 만든다(위임 없이 직접 생성 —
    // `loadAuth()` 재호출 1회는 `defaultCommandDeps()`와 같은 비용).
    createClient: () => new ApiClient({ token: loadAuth()?.token ?? null }),
    createReadLine: createDefaultReadLine,
    isInteractive: () => Boolean(process.stdin.isTTY),
    cwd: () => process.cwd(),
  };
}

function presentNotInteractive(deps: CommandDeps): void {
  deps.errorLog(
    '✗ 대화형 터미널이 아닙니다\n  비대화형 환경에서는 cm chat send <채널> "<본문>"을 사용하세요',
  );
  deps.setExitCode(1);
}

function presentChatAgentOpenFailure(
  opened: Exclude<ChatAgentOpenResult, { ok: true }>,
  deps: CommandDeps,
): void {
  switch (opened.reason) {
    case 'not_found':
      deps.errorLog(notFoundBlock('Agent', opened.id, 'cm agent list'));
      break;
    case 'ambiguous':
      deps.errorLog(ambiguousIdBlock(opened.candidates));
      break;
    case 'no_conversation':
      deps.errorLog(`✗ 이 Agent의 대화 채널을 찾을 수 없습니다: ${opened.agentId}`);
      break;
    case 'server_unreachable':
      deps.errorLog(serverUnreachableBlock(opened.serverUrl));
      break;
    case 'unauthenticated':
      deps.errorLog(unauthenticatedBlock(false));
      break;
  }
  deps.setExitCode(1);
}

function presentChatAgentHeader(
  deps: CommandDeps,
  opened: Extract<ChatAgentOpenResult, { ok: true }>,
): void {
  const { agent, messages, readonly } = opened;
  const waiting =
    agent.status === AgentStatus.WAITING && agent.waitingReason
      ? ` (${WAITING_REASON_LABEL[agent.waitingReason] ?? agent.waitingReason})`
      : '';
  deps.log(
    successBlock(
      agent.name,
      `상태: ${agent.status}${waiting}  채널: ${readonly ? 'readonly' : 'active'}`,
    ),
  );
  printMessageHistory(deps, messages);
}

async function runReplSession(
  deps: ChatCommandDeps,
  client: CliApiClient,
  conversationId: string,
): Promise<void> {
  const io = deps.createReadLine();
  try {
    const { sentCount } = await runChatRepl({
      client,
      conversationId,
      readLine: io.readLine,
      log: deps.log,
      errorLog: deps.errorLog,
    });
    deps.log(successBlock('세션 종료', `전송 ${sentCount}건`));
    deps.setExitCode(0);
  } finally {
    io.close();
  }
}

export function registerChatCommand(
  program: Command,
  overrides: Partial<ChatCommandDeps> = {},
): void {
  const deps: ChatCommandDeps = { ...defaultChatCommandDeps(), ...overrides };
  const chat = program.command('chat').description('대화 채널');

  chat
    .command('main')
    .description('Main과 대화한다 (SCR-CH01, REPL)')
    .action(async () => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      if (!deps.isInteractive()) return presentNotInteractive(deps);

      const client = deps.createClient();
      const opened = await runChatMainOpen({ client });
      if (!opened.ok) {
        if (opened.reason === 'conversation_not_found') {
          deps.errorLog('✗ CH-MAIN 채널을 찾을 수 없습니다 (서버가 정상 기동됐는지 확인하세요)');
        } else if (opened.reason === 'server_unreachable') {
          deps.errorLog(serverUnreachableBlock(opened.serverUrl));
        } else {
          deps.errorLog(unauthenticatedBlock(false));
        }
        deps.setExitCode(1);
        return;
      }

      deps.log(successBlock('Main', `채널: ${opened.conversation.title}`));
      printMessageHistory(deps, opened.messages);
      deps.log('\n  /exit 또는 Ctrl+D·Ctrl+C로 종료합니다. 실시간 수신은 Phase 1 범위 밖입니다.');
      await runReplSession(deps, client, opened.conversation.id);
    });

  chat
    .command('agent')
    .description('Agent와 대화한다 (SCR-CH02, REPL)')
    .argument('<id>', 'Agent ID (전체 또는 앞 8자리)')
    .action(async (id: string) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      if (!deps.isInteractive()) return presentNotInteractive(deps);

      const client = deps.createClient();
      const opened = await runChatAgentOpen({ client, idOrPrefix: id });
      if (!opened.ok) return presentChatAgentOpenFailure(opened, deps);

      presentChatAgentHeader(deps, opened);
      if (opened.readonly) {
        deps.errorLog('\n⚠ 종료된 채널입니다 (읽기 전용)');
        deps.setExitCode(0);
        return;
      }

      deps.log('\n  /exit 또는 Ctrl+D·Ctrl+C로 종료합니다. 실시간 수신은 Phase 1 범위 밖입니다.');
      await runReplSession(deps, client, opened.agent.conversationId as string);
    });

  chat
    .command('send')
    .description('채널에 1회 메시지를 전송한다 (SCR-CH03, 비대화형)')
    .argument('<channel>', `채널 (${ChannelType.MAIN} 또는 Agent ID)`)
    .argument('<body>', '전송할 본문')
    .action(async (channel: string, body: string) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runChatSend({ client: deps.createClient(), channel, body });
      presentChatSend(result, deps);
    });

  chat
    .command('list')
    .description('대화 채널 목록을 조회한다 (SCR-CH11)')
    .option('--type <type>', `채널 종류 필터 (${CHANNEL_TYPE_VALUES.join('|')})`)
    .option('--status <status>', `상태 필터 (${CONVERSATION_STATUS_VALUES.join('|')})`)
    .action(async (opts: { type?: string; status?: string }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runChatList({
        client: deps.createClient(),
        type: opts.type,
        status: opts.status,
      });
      presentChatList(result, deps);
    });

  chat
    .command('log')
    .description('대화 본문을 출력하거나 마크다운으로 내보낸다 (SCR-CH12)')
    .argument('<channelId>', '대화 채널 ID (전체 또는 앞 8자리)')
    .option('--since <date>', '이 시각 이후 메시지만 (ISO 8601)')
    .option('--export [path]', '마크다운으로 저장한다 (기본: 현재 디렉토리)')
    .action(async (channelId: string, opts: { since?: string; export?: string | true }) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);

      if (opts.export !== undefined) {
        const exportPath = typeof opts.export === 'string' ? opts.export : undefined;
        const result = await runChatExport({
          client: deps.createClient() as ChatExportClient,
          idOrPrefix: channelId,
          exportPath,
          cwd: deps.cwd(),
          now: deps.now ?? (() => new Date()),
        });
        presentChatExport(result, deps);
        return;
      }

      const result = await runChatLog({
        client: deps.createClient(),
        idOrPrefix: channelId,
        since: opts.since,
      });
      presentChatLog(result, deps);
    });

  chat
    .command('search')
    .description('전 채널 메시지를 전문 검색한다 (SCR-CH13)')
    .argument('<query>', '검색어 (2자 이상)')
    .action(async (query: string) => {
      const guard = checkAuth(deps.homeDir, deps.now);
      if (!guard.ok) return presentAuthGuardFailure(guard, deps);
      const result = await runChatSearch({ client: deps.createClient(), q: query });
      presentChatSearch(result, deps);
    });
}
