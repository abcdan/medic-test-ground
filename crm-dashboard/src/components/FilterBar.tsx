import { useEffect, useState } from "react";
import { DEAL_STAGES, STAGE_LABELS, type DealStage } from "../types";
import { useFilter, useStore } from "../state/store";
import { useDebounce } from "../hooks/useDebounce";
import { activeFilterCount } from "../utils/filters";
import { Badge, Button } from "./primitives";

export function FilterBar({ showStage = false }: { showStage?: boolean }) {
  const [filter, setFilter] = useFilter();
  const { state, dispatch } = useStore();

  const [searchInput, setSearchInput] = useState(filter.search);
  const debouncedSearch = useDebounce(searchInput, 250);

  useEffect(() => {
    setFilter({ search: debouncedSearch });
  }, [debouncedSearch]);

  const count = activeFilterCount(filter);

  return (
    <div className="filter-bar">
      <input
        className="filter-bar__search"
        type="search"
        placeholder="Search…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />

      <select
        value={filter.ownerId ?? ""}
        onChange={(e) => setFilter({ ownerId: e.target.value || null })}
      >
        <option value="">All owners</option>
        {state.users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.name}
          </option>
        ))}
      </select>

      {showStage && (
        <select
          value={filter.stage ?? ""}
          onChange={(e) => setFilter({ stage: (e.target.value || null) as DealStage | null })}
        >
          <option value="">All stages</option>
          {DEAL_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </option>
          ))}
        </select>
      )}

      <input
        type="date"
        value={filter.createdAfter ?? ""}
        onChange={(e) => setFilter({ createdAfter: e.target.value || null })}
      />
      <input
        type="date"
        value={filter.createdBefore ?? ""}
        onChange={(e) => setFilter({ createdBefore: e.target.value || null })}
      />

      {count > 0 && (
        <>
          <Badge tone="info">{count} active</Badge>
          <Button variant="ghost" onClick={() => dispatch({ type: "clear-filter" })}>
            Clear
          </Button>
        </>
      )}
    </div>
  );
}
