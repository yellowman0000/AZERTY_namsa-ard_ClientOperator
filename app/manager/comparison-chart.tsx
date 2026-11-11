'use client';

/**
 * Side-by-side column chart used by the stakeholder analytics view (Story 09).
 *
 * Two (or more) values are drawn as columns of equal width on a shared scale so
 * a stakeholder can compare them at a glance. It is dependency-free inline
 * SVG, exposed to assistive technology through `role="img"` plus a title and a
 * text description; the values and shares are also printed under each column.
 */
import type { StakeholderComparisonDatum } from '../../lib/stakeholderAnalytics';

const VIEW_WIDTH = 480;
const VIEW_HEIGHT = 240;
const BASELINE_Y = 188;
const TOP_Y = 26;
const PLOT_HEIGHT = BASELINE_Y - TOP_Y;
const COLUMN_WIDTH = 104;
const COLUMN_GAP = 64;
const GROUP_WIDTH = COLUMN_WIDTH * 2 + COLUMN_GAP;

export interface ComparisonChartProps {
  /** Unique prefix for the SVG's title/description ids. */
  idPrefix: string;
  title: string;
  description: string;
  data: StakeholderComparisonDatum[];
  /** Formatted value printed above each column and in the description. */
  formatValue: (value: number) => string;
  emptyMessage?: string;
}

export function ComparisonChart({
  idPrefix,
  title,
  description,
  data,
  formatValue,
  emptyMessage = 'No values were recorded for this month.',
}: ComparisonChartProps) {
  const max = data.reduce((current, datum) => Math.max(current, datum.value), 0);

  if (max <= 0) {
    return <p className="logs-message">{emptyMessage}</p>;
  }

  const startX = (VIEW_WIDTH - GROUP_WIDTH) / 2;
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <figure className="chart-card comparison-chart">
      <figcaption>
        <strong>{title}</strong>
        <span>{description}</span>
      </figcaption>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <title id={titleId}>{title}</title>
        <desc id={descriptionId}>
          {`${description}: ${data
            .map((datum) => `${datum.label} ${formatValue(datum.value)}`)
            .join(', ')}.`}
        </desc>
        {data.map((datum, index) => {
          const x = startX + index * (COLUMN_WIDTH + COLUMN_GAP);
          const value = Number.isFinite(datum.value) ? Math.max(datum.value, 0) : 0;
          const barHeight = (value / max) * PLOT_HEIGHT;
          const y = BASELINE_Y - barHeight;
          const center = x + COLUMN_WIDTH / 2;

          return (
            <g key={datum.key}>
              <rect
                className={`chart-bar chart-bar-${datum.tone}`}
                x={x}
                y={y}
                width={COLUMN_WIDTH}
                height={barHeight}
                rx={4}
                data-key={datum.key}
                data-value={datum.value}
              />
              <text
                className="chart-value-text"
                x={center}
                y={Math.max(y - 8, TOP_Y + 2)}
                textAnchor="middle"
              >
                {formatValue(datum.value)}
              </text>
              <text
                className="chart-column-label"
                x={center}
                y={BASELINE_Y + 22}
                textAnchor="middle"
              >
                {datum.label}
              </text>
              <text
                className="chart-axis-text"
                x={center}
                y={BASELINE_Y + 38}
                textAnchor="middle"
              >
                {(datum.share * 100).toFixed(1)}%
              </text>
            </g>
          );
        })}
        <line
          className="chart-baseline"
          x1={startX}
          x2={VIEW_WIDTH - startX}
          y1={BASELINE_Y}
          y2={BASELINE_Y}
        />
      </svg>
    </figure>
  );
}
