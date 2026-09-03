import type { StageSummary, WipViolation } from '../../../shared/types.js';
import { getPhaseCurrent } from '../api/endpoints';
import { ErrorView, LoadingView } from '../components/StateView';
import { useAsync } from '../hooks/useAsync';

const SKILL_LABELS: Record<string, string> = {
  plan: '기획',
  analyze: '분석',
  design: '설계',
  develop: '개발',
  test: '테스트',
  deploy: '배포',
  operate: '운영',
};

const STAGE_STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  in_progress: '진행 중',
  completed: '완료',
};

const STAGE_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
};

function StageCard({ stage }: { stage: StageSummary }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">
          {SKILL_LABELS[stage.skill] ?? stage.skill}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            STAGE_STATUS_STYLES[stage.status] ?? 'bg-slate-100 text-slate-500'
          }`}
        >
          {STAGE_STATUS_LABELS[stage.status] ?? stage.status}
        </span>
      </div>
      <dl className="mt-3 space-y-1 text-xs text-slate-500">
        <div className="flex justify-between">
          <dt>산출물</dt>
          <dd>{stage.artifactCount}건</dd>
        </div>
        <div className="flex justify-between">
          <dt>대기 승인</dt>
          <dd>{stage.pendingApprovalCount}건</dd>
        </div>
        <div className="flex justify-between">
          <dt>게이트</dt>
          <dd>{stage.gate.required ? (stage.gate.passed ? '통과' : '대기') : '해당 없음'}</dd>
        </div>
      </dl>
    </div>
  );
}

function WipViolationRow({ violation }: { violation: WipViolation }) {
  return (
    <li
      className={`rounded-md border px-3 py-2 text-sm ${
        violation.waived
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-red-200 bg-red-50 text-red-700'
      }`}
    >
      <span className="font-medium">{violation.rule}</span> — {violation.detail}
      {violation.waived ? ' (면제됨)' : ''}
    </li>
  );
}

export function BoardPage() {
  const { data, loading, error, reload } = useAsync(getPhaseCurrent, []);

  if (loading) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  const { phase, stages, wipViolations } = data.data;

  return (
    <div className="p-6">
      <header className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Phase {phase.number}
        </p>
        <h1 className="text-lg font-semibold text-slate-900">{phase.name}</h1>
        <p className="mt-1 text-sm text-slate-500">
          현재 단계:{' '}
          {phase.currentStage ? (SKILL_LABELS[phase.currentStage] ?? phase.currentStage) : '없음'}
        </p>
      </header>

      {wipViolations.length > 0 ? (
        <ul className="mb-6 space-y-2">
          {wipViolations.map((violation) => (
            <WipViolationRow key={`${violation.rule}-${violation.detail}`} violation={violation} />
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {stages.map((stage) => (
          <StageCard key={stage.id} stage={stage} />
        ))}
      </div>
    </div>
  );
}
