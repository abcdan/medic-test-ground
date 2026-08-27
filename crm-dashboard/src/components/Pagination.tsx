import type { Pagination as PaginationState } from "../hooks/usePagination";
import { PAGE_SIZES } from "../hooks/usePagination";
import { formatNumber } from "../utils/format";

export function Pagination({ state, total }: { state: PaginationState; total: number }) {
  const pages: number[] = [];
  for (let p = Math.max(1, state.page - 2); p <= Math.min(state.totalPages, state.page + 2); p++) {
    pages.push(p);
  }

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination__summary">
        {formatNumber(state.from)}–{formatNumber(state.to)} of {formatNumber(total)}
      </span>

      <button disabled={!state.canPrevious} onClick={state.previous}>
        Previous
      </button>

      {pages.map((page) => (
        <button
          key={page}
          className={page === state.page ? "is-current" : undefined}
          onClick={() => state.goTo(page)}
        >
          {page}
        </button>
      ))}

      <button disabled={!state.canNext} onClick={state.next}>
        Next
      </button>

      <select value={state.pageSize} onChange={(e) => state.setPageSize(Number(e.target.value))}>
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size} per page
          </option>
        ))}
      </select>
    </nav>
  );
}
