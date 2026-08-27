import { useCallback, useEffect, useRef, useState } from "react";

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * Run an async loader and track its state.
 *
 * The loader is given an AbortSignal so an in-flight request is cancelled
 * when the inputs change or the component unmounts.
 */
export function useFetch<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[]): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    loader(controller.signal)
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err);
        setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, refetch };
}

/** Fire-and-forget mutation with pending/error state. */
export function useMutation<A extends unknown[], R>(
  mutate: (...args: A) => Promise<R>,
): {
  run: (...args: A) => Promise<R | null>;
  pending: boolean;
  error: Error | null;
} {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (...args: A) => {
      setPending(true);
      setError(null);
      try {
        return await mutate(...args);
      } catch (err) {
        setError(err as Error);
        return null;
      } finally {
        setPending(false);
      }
    },
    [mutate],
  );

  return { run, pending, error };
}
