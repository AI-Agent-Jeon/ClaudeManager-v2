import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { Message } from '../../../shared/types.js';
import { ApiError, NetworkError } from '../api/client';
import { listConversations, listMessages, sendMessage } from '../api/endpoints';
import { EmptyView, ErrorView, LoadingView } from '../components/StateView';
import { useAsync } from '../hooks/useAsync';

const SENDER_LABELS: Record<string, string> = {
  ceo: '대표',
  main: 'Main',
  agent: 'Agent',
  system: 'System',
};

function describeError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof NetworkError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return '알 수 없는 오류가 발생했습니다.';
}

function MessageBubble({ message }: { message: Message }) {
  const isCeo = message.senderRole === 'ceo';
  return (
    <div className={`flex flex-col ${isCeo ? 'items-end' : 'items-start'}`}>
      <span className="mb-1 text-xs text-slate-400">
        {SENDER_LABELS[message.senderRole] ?? message.senderRole} ·{' '}
        {new Date(message.createdAt).toLocaleString('ko-KR')}
      </span>
      <div
        className={`max-w-lg whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          isCeo ? 'bg-slate-900 text-white' : 'bg-white text-slate-800'
        } border border-slate-200`}
      >
        {/* 서버 문자열은 항상 텍스트로만 렌더한다 — dangerouslySetInnerHTML 금지 */}
        {message.body}
      </div>
    </div>
  );
}

function MessageThread({ conversationId }: { conversationId: string }) {
  const fetcher = useCallback(() => listMessages(conversationId, { limit: 50 }), [conversationId]);
  const { data, loading, error, reload } = useAsync(fetcher, [conversationId]);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const orderedMessages = useMemo(() => {
    if (!data) return [];
    // 서버는 최신순(desc)으로 준다 — 채팅창 관례대로 오래된 것부터 보여준다
    return [...data.data].reverse();
  }, [data]);

  async function handleSend(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (body.trim().length === 0) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(conversationId, body);
      setBody('');
      reload();
    } catch (cause) {
      setSendError(describeError(cause));
    } finally {
      setSending(false);
    }
  }

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {orderedMessages.length === 0 ? (
          <EmptyView>아직 메시지가 없습니다.</EmptyView>
        ) : (
          orderedMessages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
      </div>
      <form onSubmit={handleSend} className="border-t border-slate-200 p-3">
        {sendError ? (
          <p role="alert" className="mb-2 text-xs text-red-600">
            {sendError}
          </p>
        ) : null}
        <div className="flex gap-2">
          <input
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="메시지 입력…"
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          />
          <button
            type="submit"
            disabled={sending || body.trim().length === 0}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            전송
          </button>
        </div>
      </form>
    </div>
  );
}

export function ConversationsPage() {
  const { data, loading, error, reload } = useAsync(listConversations, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && data && data.data.length > 0) {
      setSelectedId(data.data[0]?.id ?? null);
    }
  }, [data, selectedId]);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data || data.data.length === 0) return <EmptyView>대화 채널이 없습니다.</EmptyView>;

  return (
    <div className="flex h-screen">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
        <ul>
          {data.data.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => setSelectedId(conversation.id)}
                className={`w-full border-b border-slate-100 px-4 py-3 text-left text-sm ${
                  selectedId === conversation.id ? 'bg-slate-100' : 'hover:bg-slate-50'
                }`}
              >
                <p className="font-medium text-slate-900">{conversation.title}</p>
                <p className="text-xs text-slate-400">
                  {conversation.channelType === 'main' ? 'CH-MAIN' : 'CH-AGENT'}
                  {conversation.unreadCount > 0 ? ` · 미읽음 ${conversation.unreadCount}` : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <section className="flex-1 bg-slate-50">
        {selectedId ? (
          <MessageThread key={selectedId} conversationId={selectedId} />
        ) : (
          <EmptyView>왼쪽에서 채널을 선택하세요.</EmptyView>
        )}
      </section>
    </div>
  );
}
