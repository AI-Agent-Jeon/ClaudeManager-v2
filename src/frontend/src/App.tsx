import { useEffect, useState } from 'react';
import { clearToken, getToken, setUnauthorizedHandler } from './api/client';
import { Nav, type ViewKey } from './components/Nav';
import { AgentsTasksPage } from './pages/AgentsTasksPage';
import { BoardPage } from './pages/BoardPage';
import { ConversationsPage } from './pages/ConversationsPage';
import { LoginPage } from './pages/LoginPage';

export function App() {
  const [token, setToken] = useState<string | null>(() => getToken());
  const [view, setView] = useState<ViewKey>('board');

  // 401을 받으면 client.ts가 토큰을 지우고 이 핸들러를 호출한다 — 로그인
  // 화면으로 돌린다(develop 위임 §반드시 지킬 것 3).
  useEffect(() => {
    setUnauthorizedHandler(() => setToken(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (!token) {
    return <LoginPage onSuccess={() => setToken(getToken())} />;
  }

  function handleLogout(): void {
    clearToken();
    setToken(null);
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Nav active={view} onChange={setView} onLogout={handleLogout} />
      <main className="flex-1 overflow-y-auto">
        {view === 'board' ? <BoardPage /> : null}
        {view === 'agents' ? <AgentsTasksPage /> : null}
        {view === 'conversations' ? <ConversationsPage /> : null}
      </main>
    </div>
  );
}
