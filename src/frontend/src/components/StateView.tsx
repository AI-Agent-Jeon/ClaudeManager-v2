import type { ReactNode } from 'react';

/** 로딩·에러·빈 상태를 화면마다 다르게 그리지 않도록 통일한다. */
export function LoadingView() {
  return <p className="p-6 text-sm text-slate-500">불러오는 중…</p>;
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="m-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
    >
      <p className="font-medium">문제가 발생했습니다</p>
      <p className="mt-1">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
        >
          다시 시도
        </button>
      ) : null}
    </div>
  );
}

export function EmptyView({ children }: { children: ReactNode }) {
  return <p className="p-6 text-sm text-slate-400">{children}</p>;
}
