import { useEffect, useState, useRef, useCallback } from "react";

/** Value that only updates after the input has been still for `delay` ms. */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/** Debounced callback. The latest arguments win. */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay = 300,
): (...args: A) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (...args: A) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay],
  );
}

/** Run a callback at most once per `interval` ms. */
export function useThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
  interval = 500,
): (...args: A) => void {
  const lastRun = useRef(0);

  return useCallback(
    (...args: A) => {
      const now = Date.now();
      if (now - lastRun.current < interval) return;
      lastRun.current = now;
      fn(...args);
    },
    [fn, interval],
  );
}
