import { listAgents, listTasks } from '../api/endpoints';
import { EmptyView, ErrorView, LoadingView } from '../components/StateView';
import { useAsync } from '../hooks/useAsync';

const STATUS_LABELS: Record<string, string> = {
  created: '생성됨',
  ready: '준비',
  running: '진행 중',
  in_progress: '진행 중',
  in_review: '검토 중',
  waiting: '대기',
  paused: '일시정지',
  completed: '완료',
  failed: '실패',
  cancelled: '취소',
  skipped: '건너뜀',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function AgentsTable() {
  const { data, loading, error, reload } = useAsync(listAgents, []);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data || data.data.length === 0) return <EmptyView>등록된 Agent가 없습니다.</EmptyView>;

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
          <th className="py-2 pr-4 font-medium">이름</th>
          <th className="py-2 pr-4 font-medium">타입</th>
          <th className="py-2 pr-4 font-medium">Skill</th>
          <th className="py-2 pr-4 font-medium">상태</th>
        </tr>
      </thead>
      <tbody>
        {data.data.map((agent) => (
          <tr key={agent.id} className="border-b border-slate-100">
            <td className="py-2 pr-4 font-medium text-slate-900">{agent.name}</td>
            <td className="py-2 pr-4 text-slate-500">{agent.type}</td>
            <td className="py-2 pr-4 text-slate-500">{agent.skill}</td>
            <td className="py-2 pr-4">
              <StatusBadge status={agent.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TasksTable() {
  const { data, loading, error, reload } = useAsync(listTasks, []);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data || data.data.length === 0) return <EmptyView>등록된 Task가 없습니다.</EmptyView>;

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
          <th className="py-2 pr-4 font-medium">제목</th>
          <th className="py-2 pr-4 font-medium">Agent ID</th>
          <th className="py-2 pr-4 font-medium">상태</th>
        </tr>
      </thead>
      <tbody>
        {data.data.map((task) => (
          <tr key={task.id} className="border-b border-slate-100">
            <td className="py-2 pr-4 font-medium text-slate-900">{task.title}</td>
            <td className="py-2 pr-4 text-slate-500">{task.agentId}</td>
            <td className="py-2 pr-4">
              <StatusBadge status={task.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AgentsTasksPage() {
  return (
    <div className="space-y-8 p-6">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Agent</h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <AgentsTable />
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Task</h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <TasksTable />
        </div>
      </section>
    </div>
  );
}
