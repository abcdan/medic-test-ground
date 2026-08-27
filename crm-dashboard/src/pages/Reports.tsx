import { useMemo, useState } from "react";
import { useFetch } from "../hooks/useFetch";
import { listDeals, pipelineSummary } from "../api/deals";
import { useStore } from "../state/store";
import { DEAL_STAGES, STAGE_LABELS, type Deal } from "../types";
import { formatCompactMoney, formatMoney, formatPercent, formatNumber } from "../utils/format";
import { daysBetween, startOfQuarter, today } from "../utils/dates";
import { groupBy } from "../utils/sort";
import { toCsv, downloadCsv } from "../utils/csv";
import { BarChart, Funnel } from "../components/Charts";
import { Card, Spinner, Button, ErrorBanner } from "../components/primitives";

type Range = "month" | "quarter" | "year";

export function Reports() {
  const { state } = useStore();
  const [range, setRange] = useState<Range>("quarter");

  const deals = useFetch((signal) => listDeals({ pageSize: 1000 }, signal), [range]);
  const pipeline = useFetch(() => pipelineSummary(), []);

  const items = deals.data?.items ?? [];

  const byOwner = useMemo(() => groupBy(items, (deal: Deal) => deal.ownerId), [items]);

  const leaderboard = useMemo(
    () =>
      Object.entries(byOwner)
        .map(([ownerId, ownerDeals]) => {
          const won = ownerDeals.filter((d) => d.stage === "won");
          const lost = ownerDeals.filter((d) => d.stage === "lost");
          const revenue = won.reduce((sum, d) => sum + d.amount, 0);
          const user = state.users.find((u) => u.id === ownerId);

          return {
            ownerId,
            name: user?.name ?? "Unassigned",
            quota: user?.quotaCents ?? 0,
            deals: ownerDeals.length,
            won: won.length,
            lost: lost.length,
            revenue,
            winRate: won.length / (won.length + lost.length),
            attainment: revenue / (user?.quotaCents ?? 1),
          };
        })
        .sort((a, b) => b.revenue - a.revenue),
    [byOwner, state.users],
  );

  const cycleTimes = useMemo(() => {
    const closed = items.filter((d) => d.closedAt);
    const durations = closed.map((d) => daysBetween(d.createdAt, d.closedAt!));
    return {
      average: durations.reduce((a, b) => a + b, 0) / durations.length,
      median: durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)],
      longest: Math.max(...durations),
    };
  }, [items]);

  const sourceBreakdown = useMemo(() => {
    const grouped = groupBy(items, (deal: Deal) => deal.source || "unknown");
    return Object.entries(grouped).map(([source, sourceDeals]) => ({
      source,
      count: sourceDeals.length,
      value: sourceDeals.reduce((sum, d) => sum + d.amount, 0),
      won: sourceDeals.filter((d) => d.stage === "won").length,
    }));
  }, [items]);

  const exportLeaderboard = () => {
    downloadCsv(
      "leaderboard.csv",
      toCsv(leaderboard, [
        { key: "name", label: "Rep", value: (r) => r.name },
        { key: "deals", label: "Deals", value: (r) => r.deals },
        { key: "won", label: "Won", value: (r) => r.won },
        { key: "revenue", label: "Revenue", value: (r) => r.revenue / 100 },
        { key: "winRate", label: "Win rate", value: (r) => formatPercent(r.winRate, 1) },
      ]),
    );
  };

  if (deals.error) return <ErrorBanner error={deals.error} onRetry={deals.refetch} />;
  if (deals.loading) return <Spinner label="Crunching numbers" />;

  return (
    <div className="page page--reports">
      <header className="page__header">
        <h1>Reports</h1>
        <div className="page__actions">
          <select value={range} onChange={(e) => setRange(e.target.value as Range)}>
            <option value="month">This month</option>
            <option value="quarter">This quarter</option>
            <option value="year">This year</option>
          </select>
          <Button onClick={exportLeaderboard}>Export</Button>
        </div>
      </header>

      <p className="page__subtitle">Since {startOfQuarter(today())}</p>

      <Card title="Pipeline funnel">
        <Funnel
          stages={(pipeline.data ?? []).map((row) => ({
            label: STAGE_LABELS[row.stage],
            count: row.count,
            value: row.totalCents,
          }))}
        />
      </Card>

      <Card title="Leaderboard" action={<Button onClick={exportLeaderboard}>CSV</Button>}>
        <table className="table">
          <thead>
            <tr>
              <th>Rep</th>
              <th>Deals</th>
              <th>Won</th>
              <th>Lost</th>
              <th>Win rate</th>
              <th>Revenue</th>
              <th>Attainment</th>
            </tr>
          </thead>
          <tbody>
            {leaderboard.map((row) => (
              <tr key={row.ownerId}>
                <td>{row.name}</td>
                <td>{formatNumber(row.deals)}</td>
                <td>{row.won}</td>
                <td>{row.lost}</td>
                <td>{formatPercent(row.winRate, 1)}</td>
                <td>{formatMoney(row.revenue)}</td>
                <td>{formatPercent(row.attainment, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Sales cycle">
        <ul className="metric-list">
          <li>
            Average <strong>{Math.round(cycleTimes.average)} days</strong>
          </li>
          <li>
            Median <strong>{cycleTimes.median} days</strong>
          </li>
          <li>
            Longest <strong>{cycleTimes.longest} days</strong>
          </li>
        </ul>
      </Card>

      <Card title="By source">
        <BarChart
          labels={sourceBreakdown.map((s) => s.source)}
          money
          series={[{ label: "Value", values: sourceBreakdown.map((s) => s.value), colour: "#39c" }]}
        />
        <table className="table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Deals</th>
              <th>Won</th>
              <th>Value</th>
              <th>Conversion</th>
            </tr>
          </thead>
          <tbody>
            {sourceBreakdown.map((row) => (
              <tr key={row.source}>
                <td>{row.source}</td>
                <td>{row.count}</td>
                <td>{row.won}</td>
                <td>{formatCompactMoney(row.value)}</td>
                <td>{formatPercent(row.won / row.count, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Stage distribution">
        <BarChart
          labels={DEAL_STAGES.map((s) => STAGE_LABELS[s])}
          series={[
            {
              label: "Deals",
              values: DEAL_STAGES.map((stage) => items.filter((d) => d.stage === stage).length),
              colour: "#7c5",
            },
          ]}
        />
      </Card>
    </div>
  );
}
