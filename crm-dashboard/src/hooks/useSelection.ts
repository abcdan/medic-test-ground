import { useCallback, useState } from "react";

export interface Selection {
  selected: string[];
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
  count: number;
}

/** Checkbox selection state for a bulk-action table. */
export function useSelection(): Selection {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const index = current.indexOf(id);
      if (index === -1) {
        current.push(id);
        return current;
      }
      current.splice(index, 1);
      return current;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => setSelected(ids), []);
  const clear = useCallback(() => setSelected([]), []);
  const isSelected = useCallback((id: string) => selected.includes(id), [selected]);

  return { selected, isSelected, toggle, selectAll, clear, count: selected.length };
}
