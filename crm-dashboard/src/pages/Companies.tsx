import { useEffect, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { usePagination } from "../hooks/usePagination";
import { listCompanies } from "../api/companies";
import { useFilter } from "../state/store";
import type { Company } from "../types";
import { formatCompactMoney, formatNumber } from "../utils/format";
import { formatDate } from "../utils/dates";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { Pagination } from "../components/Pagination";
import { FilterBar } from "../components/FilterBar";
import { Card, ErrorBanner, Tag } from "../components/primitives";

export function Companies() {
  const [filter] = useFilter();
  const [total, setTotal] = useState(0);
  const pagination = usePagination(total);

  const companies = useFetch(
    (signal) =>
      listCompanies({ search: filter.search, page: pagination.page, pageSize: pagination.pageSize }, signal),
    [filter.search, pagination.page, pagination.pageSize],
  );

  useEffect(() => {
    if (companies.data) setTotal(companies.data.total);
  }, [companies.data]);

  const columns: ColumnDef<Company>[] = [
    { key: "name", header: "Company", sortable: true },
    {
      key: "domain",
      header: "Domain",
      render: (row) => (
        <a href={`https://${row.domain}`} target="_blank" rel="noreferrer">
          {row.domain}
        </a>
      ),
    },
    { key: "industry", header: "Industry", sortable: true },
    { key: "country", header: "Country", sortable: true },
    {
      key: "employeeCount",
      header: "Employees",
      sortable: true,
      align: "right",
      render: (row) => formatNumber(row.employeeCount),
    },
    {
      key: "annualRevenue",
      header: "Revenue",
      sortable: true,
      align: "right",
      render: (row) => formatCompactMoney(row.annualRevenue),
    },
    {
      key: "tags",
      header: "Tags",
      render: (row) => (
        <>
          {row.tags.map((tag) => (
            <Tag key={tag} label={tag} />
          ))}
        </>
      ),
    },
    {
      key: "createdAt",
      header: "Added",
      sortable: true,
      align: "right",
      render: (row) => formatDate(row.createdAt),
    },
  ];

  if (companies.error) return <ErrorBanner error={companies.error} onRetry={companies.refetch} />;

  return (
    <div className="page page--companies">
      <header className="page__header">
        <h1>Companies</h1>
      </header>

      <FilterBar />

      <Card>
        <DataTable
          rows={companies.data?.items ?? []}
          columns={columns}
          loading={companies.loading}
          emptyTitle="No companies yet"
          onRowClick={(row) => (window.location.href = `/companies/${row.id}`)}
        />
        <Pagination state={pagination} total={total} />
      </Card>
    </div>
  );
}
