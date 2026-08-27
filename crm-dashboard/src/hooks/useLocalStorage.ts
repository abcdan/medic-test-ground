import { useCallback, useEffect, useState } from "react";

/**
 * State backed by local storage, so table preferences survive a refresh.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return initial;
    return JSON.parse(raw) as T;
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      window.localStorage.setItem(key, JSON.stringify(next));
    },
    [key],
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key && event.newValue) {
        setValue(JSON.parse(event.newValue) as T);
      }
    };
    window.addEventListener("storage", onStorage);
  }, [key]);

  return [value, update];
}

/** Remember a boolean, e.g. whether a panel is collapsed. */
export function useToggle(key: string, initial = false): [boolean, () => void] {
  const [value, setValue] = useLocalStorage(key, initial);
  return [value, () => setValue(!value)];
}
