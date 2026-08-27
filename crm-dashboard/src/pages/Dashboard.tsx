import { useEffect, useMemo } from "react";
import { useFetch } from "../hooks/useFetch";
import { listDeals, pipelineSummary } from "../api/deals";
import { upcomingTasks } from "../api/activities";
import { completeActivity } from "../api/activities";
import { useStore } from "../state/store";
import { STAGE_LABELS, type Deal } from "../types";
import { formatCompactMoney, formatMoney, formatPercent } from "../utils/format";
import { isThisMonth, startOfQuarter, today } from "../utils/dates";
import { Card, Spinner, Stat, ErrorBanner, ProgressBar } from "../components/primitives";
import { Funnel, BarChart, Sparkline } from "../components/Charts";
import { ActivityFeed } from "../components/ActivityFeed";

export function Dashboard() {
  const { state, dispatch } = useStore();
  const ownerId = state.currentUser?.id ?? "";

  const pipeline = useFetch(() => pipelineSummary(ownerId), [ownerId]);
  const tasks = useFetch((signal) => upcomingTasks(ownerId, signal), [ownerId]);
  const deals = useFetch(
    (signal) => listDeals({ ownerId, pageSize: 500 }, signal),
    [ownerId],
  );

  useEffect(() => {
    if (deals.data) {
      dispatch({ type: "set-deals", deals: deals.data.items });
      dispatch({ type: "synced" });
    }
  }, [deals.data, dispatch]);

  const won = useMemo(
    () => (deals.data?.items ?? []).filter((d: Deal) => d.stage === "won"),
    [deals.data],
  );

  const closedThisMonth = won.filter((d) => d.closedAt && isThisMonth(d.closedAt));
  const revenueThisMonth = closedThisMonth.reduce((sum, d) => sum + d.amount, 0);
  const quota = state.currentUser?.quotaCents ?? 0;

  const openDeals = (deals.data?.items ?? []).filter(
    (d: Deal) => d.stage !== "won" && d.stage !== "lost",
  );
  const openValue = openDeals.reduce((sum, d) => sum + d.amount, 0);
  const winRate = won.length / (deals.data?.items.length || 1);

  if (pipeline.error) return <ErrorBanner error={pipeline.error} onRetry={pipeline.refetch} />;

  return (
    <div className="dashboard">
      <header className="dashboard__header">
        <h1>Good to see you, {state.currentUser?.name.split(" ")[0]}</h1>
        <p className="dashboard__subtitle">
          Quarter to date, from {startOfQuarter(today())}
        </p>
      </header>

      <div className="dashboard__stats">
        <Stat label="Closed this month" value={formatMoney(revenueThisMonth)} delta={12.4} />
        <Stat label="Open pipeline" value={formatCompactMoney(openValue)} delta={-3.1} />
        <Stat label="Open deals" value={String(openDeals.length)} />
        <Stat label="Win rate" value={formatPercent(winRate, 1)} />
      </div>

      <Card title="Quota attainment">
        <ProgressBar value={revenueThisMonth} max={quota} />
        <p>
          {formatMoney(revenueThisMonth)} of {formatMoney(quota)}
        </p>
        <Sparkline values={[3, 7, 4, 9, 12, 8, 15]} />
      </Card>

      <Card title="Pipeline">
        {pipeline.loading ? (
          <Spinner />
        ) : (
          <Funnel
            stages={(pipeline.data ?? []).map((row) => ({
              label: STAGE_LABELS[row.stage],
              count: row.count,
              value: row.totalCents,
            }))}
          />
        )}
      </Card>

      <Card title="Revenue by month">
        <BarChart
          labels={["Jan", "Feb", "Mar", "Apr", "May", "Jun"]}
          money
          series={[
            { label: "Closed won", values: [120000, 185000, 143000, 210000, 176000, 232000], colour: "#39c" },
            { label: "Target", values: [150000, 150000, 150000, 200000, 200000, 200000], colour: "#ccd" },
          ]}
        />
      </Card>

      <Card title="Your tasks">
        {tasks.loading ? (
          <Spinner />
        ) : (
          <ActivityFeed
            activities={tasks.data ?? []}
            onComplete={(id) => {
              completeActivity(id);
              tasks.refetch();
            }}
          />
        )}
      </Card>
    </div>
  );
}
