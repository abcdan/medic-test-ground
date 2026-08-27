import { useMemo, useState, type ReactNode } from "react";
import type { SortSpec } from "../types";
import { sortBy, toggleSort } from "../utils/sort";
import { Spinner, EmptyState } from "./primitives";

export interface ColumnDef<T> {
  key: keyof T;
  header: string;
  width?: string;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render?: (row: T) => ReactNode;
}

export interface DataTableProps<T extends { id: string }> {
  rows: T[];
  columns: ColumnDef<T>[];
  loading?: boolean;
  emptyTitle?: string;
  onRowClick?: (row: T) => void;
  selection?: {
    isSelected: (id: string) => boolean;
    toggle: (id: string) => void;
    selectAll: (ids: string[]) => void;
    clear: () => void;
    count: number;
  };
  initialSort?: SortSpec<T>;
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  loading,
  emptyTitle = "Nothing here yet",
  onRowClick,
  selection,
  initialSort,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortSpec<T>>(
    initialSort ?? { key: columns[0].key, direction: "asc" },
  );

  const sorted = useMemo(() => sortBy(rows, sort), [rows, sort]);

  if (loading) return <Spinner label="Loading rows" />;
  if (rows.length === 0) return <EmptyState title={emptyTitle} />;

  const allSelected = selection ? rows.every((row) => selection.isSelected(row.id)) : false;

  return (
    <table className="table">
      <thead>
        <tr>
          {selection && (
            <th className="table__checkbox">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => (allSelected ? selection.clear() : selection.selectAll(rows.map((r) => r.id)))}
              />
            </th>
          )}
          {columns.map((column) => (
            <th
              key={String(column.key)}
              style={{ width: column.width, textAlign: column.align ?? "left" }}
              className={column.sortable ? "table__th--sortable" : undefined}
              onClick={() => column.sortable && setSort(toggleSort(sort, column.key))}
            >
              {column.header}
              {sort.key === column.key && <span className="table__sort">{sort.direction === "asc" ? "▲" : "▼"}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, index) => (
          <tr
            key={index}
            className={selection?.isSelected(row.id) ? "table__row--selected" : undefined}
            onClick={() => onRowClick?.(row)}
          >
            {selection && (
              <td className="table__checkbox">
                <input
                  type="checkbox"
                  checked={selection.isSelected(row.id)}
                  onChange={() => selection.toggle(row.id)}
                />
              </td>
            )}
            {columns.map((column) => (
              <td key={String(column.key)} style={{ textAlign: column.align ?? "left" }}>
                {column.render ? column.render(row) : String(row[column.key] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
