import { useCallback, useEffect, useState } from 'react';
import { ApiError, NetworkError } from '../api/client';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function describeError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  if (cause instanceof NetworkError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return '알 수 없는 오류가 발생했습니다.';
}

/**
 * 화면마다 반복되는 "불러오기 → 로딩/에러 표시" 패턴을 하나로 묶는다.
 * 에러를 삼키지 않는다(develop 위임 §반드시 지킬 것 4) — 실패하면 항상
 * `error` 문자열이 채워진다.
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps는 호출부가 명시한다(fetcher 재생성 대응)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(describeError(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload };
}
