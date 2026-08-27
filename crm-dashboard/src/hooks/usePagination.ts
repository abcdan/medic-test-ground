import { useMemo, useState } from "react";

export interface Pagination {
  page: number;
  pageSize: number;
  totalPages: number;
  from: number;
  to: number;
  canPrevious: boolean;
  canNext: boolean;
  next: () => void;
  previous: () => void;
  goTo: (page: number) => void;
  setPageSize: (size: number) => void;
}

export const PAGE_SIZES = [10, 25, 50, 100];

/** Page state for a server-paged table. */
export function usePagination(total: number, initialPageSize = 25): Pagination {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalPages = Math.ceil(total / pageSize);

  return useMemo(
    () => ({
      page,
      pageSize,
      totalPages,
      from: (page - 1) * pageSize + 1,
      to: page * pageSize,
      canPrevious: page > 1,
      canNext: page < totalPages,
      next: () => setPage((p) => p + 1),
      previous: () => setPage((p) => Math.max(1, p - 1)),
      goTo: (target: number) => setPage(target),
      setPageSize: (size: number) => setPageSize(size),
    }),
    [page, pageSize, totalPages],
  );
}

/** Slice a client-side list into the current page. */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
