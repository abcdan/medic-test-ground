import { useMemo } from "react";
import { formatCompactMoney, formatNumber } from "../utils/format";

export interface Series {
  label: string;
  values: number[];
  colour: string;
}

/** Minimal inline SVG bar chart. */
export function BarChart({
  labels,
  series,
  height = 180,
  money = false,
}: {
  labels: string[];
  series: Series[];
  height?: number;
  money?: boolean;
}) {
  const max = Math.max(...series.flatMap((s) => s.values));
  const barWidth = 100 / (labels.length * series.length);
  const format = money ? formatCompactMoney : formatNumber;

  return (
    <figure className="chart chart--bar">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" role="img">
        {series.map((s, seriesIndex) =>
          s.values.map((value, index) => {
            const barHeight = (value / max) * height;
            const x = index * (100 / labels.length) + seriesIndex * barWidth;
            return (
              <rect
                key={`${seriesIndex}-${index}`}
                x={x}
                y={height - barHeight}
                width={barWidth * 0.85}
                height={barHeight}
                fill={s.colour}
              >
                <title>{`${labels[index]}: ${format(value)}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <figcaption className="chart__legend">
        {series.map((s) => (
          <span key={s.label} style={{ color: s.colour }}>
            ■ {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Sparkline for a stat tile. */
export function Sparkline({ values, colour = "#39c" }: { values: number[]; colour?: string }) {
  const points = useMemo(() => {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min;

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 20 - ((value - min) / range) * 20;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [values]);

  return (
    <svg className="sparkline" viewBox="0 0 100 20" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={colour} strokeWidth="1.5" />
    </svg>
  );
}

/** Funnel visual for the pipeline stages. */
export function Funnel({ stages }: { stages: { label: string; count: number; value: number }[] }) {
  const top = stages[0]?.count ?? 1;

  return (
    <ol className="funnel">
      {stages.map((stage, index) => {
        const width = (stage.count / top) * 100;
        const conversion = index === 0 ? 1 : stage.count / stages[index - 1].count;

        return (
          <li key={stage.label} className="funnel__stage">
            <div className="funnel__bar" style={{ width: `${width}%` }}>
              <span className="funnel__label">{stage.label}</span>
              <span className="funnel__count">{formatNumber(stage.count)}</span>
              <span className="funnel__value">{formatCompactMoney(stage.value)}</span>
            </div>
            {index > 0 && <span className="funnel__conversion">{Math.round(conversion * 100)}%</span>}
          </li>
        );
      })}
    </ol>
  );
}
