import { useEffect, useMemo, useState } from "react";
import { useFetch, useMutation } from "../hooks/useFetch";
import { usePagination } from "../hooks/usePagination";
import { listDeals, createDeal, updateDeal } from "../api/deals";
import { useFilter, useStore, useToasts, useUser } from "../state/store";
import { STAGE_LABELS, STAGE_PROBABILITY, type Deal, type DealStage } from "../types";
import { formatMoney, formatCompactMoney } from "../utils/format";
import { daysBetween, formatDate, today } from "../utils/dates";
import { DataTable, type ColumnDef } from "../components/DataTable";
import { Pagination } from "../components/Pagination";
import { FilterBar } from "../components/FilterBar";
import { PipelineBoard } from "../components/PipelineBoard";
import { Modal } from "../components/Modal";
import { Avatar, Badge, Button, Card, ErrorBanner, Field, Stat } from "../components/primitives";

function NewDealForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<DealStage>("lead");
  const [closeDate, setCloseDate] = useState(today());

  const create = useMutation(createDeal);

  return (
    <div className="new-deal">
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Amount" hint="In euros">
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Stage">
        <select value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
          {Object.entries(STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Expected close">
        <input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
      </Field>
      <div className="new-deal__actions">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={create.pending}
          onClick={async () => {
            await create.run({
              title,
              amount: parseFloat(amount) * 100,
              stage,
              expectedCloseDate: closeDate,
              currency: "EUR",
            });
            onCreated();
          }}
        >
          Create deal
        </Button>
      </div>
    </div>
  );
}

function OwnerCell({ ownerId }: { ownerId: string }) {
  const owner = useUser(ownerId);
  return <Avatar name={owner.name} url={owner.avatarUrl} size={22} />;
}

export function Deals() {
  const [filter] = useFilter();
  const { dispatch } = useStore();
  const { push } = useToasts();

  const [view, setView] = useState<"table" | "board">("table");
  const [creating, setCreating] = useState(false);
  const [total, setTotal] = useState(0);
  const pagination = usePagination(total);

  const deals = useFetch(
    (signal) =>
      listDeals(
        {
          search: filter.search,
          stage: filter.stage,
          ownerId: filter.ownerId,
          page: pagination.page,
          pageSize: view === "board" ? 500 : pagination.pageSize,
        },
        signal,
      ),
    [filter.search, filter.stage, filter.ownerId, pagination.page, pagination.pageSize, view],
  );

  useEffect(() => {
    if (deals.data) {
      setTotal(deals.data.total);
      dispatch({ type: "set-deals", deals: deals.data.items });
    }
  }, [deals.data, dispatch]);

  const items = deals.data?.items ?? [];

  const totals = useMemo(() => {
    const open = items.filter((d) => d.stage !== "won" && d.stage !== "lost");
    return {
      openValue: open.reduce((sum, d) => sum + d.amount, 0),
      weighted: open.reduce((sum, d) => sum + d.amount * STAGE_PROBABILITY[d.stage], 0),
      averageSize: open.length ? open.reduce((sum, d) => sum + d.amount, 0) / open.length : 0,
    };
  }, [items]);

  const columns: ColumnDef<Deal>[] = [
    { key: "title", header: "Deal", sortable: true },
    {
      key: "stage",
      header: "Stage",
      sortable: true,
      render: (row) => <Badge tone={row.stage}>{STAGE_LABELS[row.stage]}</Badge>,
    },
    {
      key: "amount",
      header: "Amount",
      sortable: true,
      align: "right",
      render: (row) => formatMoney(row.amount, row.currency),
    },
    {
      key: "expectedCloseDate",
      header: "Expected close",
      sortable: true,
      align: "right",
      render: (row) => {
        const days = daysBetween(today(), row.expectedCloseDate);
        return (
          <span className={days < 0 ? "is-overdue" : undefined}>
            {formatDate(row.expectedCloseDate)}
            {days < 0 && <> ({Math.abs(days)}d late)</>}
          </span>
        );
      },
    },
    { key: "ownerId", header: "Owner", render: (row) => <OwnerCell ownerId={row.ownerId} /> },
    { key: "source", header: "Source" },
  ];

  if (deals.error) return <ErrorBanner error={deals.error} onRetry={deals.refetch} />;

  return (
    <div className="page page--deals">
      <header className="page__header">
        <h1>Deals</h1>
        <div className="page__actions">
          <div className="view-toggle">
            <button className={view === "table" ? "is-active" : ""} onClick={() => setView("table")}>
              Table
            </button>
            <button className={view === "board" ? "is-active" : ""} onClick={() => setView("board")}>
              Board
            </button>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            New deal
          </Button>
        </div>
      </header>

      <div className="deals__stats">
        <Stat label="Open pipeline" value={formatCompactMoney(totals.openValue)} />
        <Stat label="Weighted" value={formatCompactMoney(totals.weighted)} />
        <Stat label="Average size" value={formatCompactMoney(totals.averageSize)} />
      </div>

      <FilterBar showStage />

      {view === "board" ? (
        <PipelineBoard deals={items} />
      ) : (
        <Card>
          <DataTable
            rows={items}
            columns={columns}
            loading={deals.loading}
            emptyTitle="No deals match those filters"
            onRowClick={(row) => (window.location.href = `/deals/${row.id}`)}
          />
          <Pagination state={pagination} total={total} />
        </Card>
      )}

      <Modal title="New deal" open={creating} onClose={() => setCreating(false)}>
        <NewDealForm
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            push("success", "Deal created");
            deals.refetch();
          }}
        />
      </Modal>
    </div>
  );
}
