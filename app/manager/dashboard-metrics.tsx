/**
 * Dashboard tables and graphs for the manager metrics views (Story 06).
 *
 * Both are pure renderings of `DashboardMetrics`, which is derived from the
 * records the date filter applied on the server. Because the page owns the
 * data hook, selecting a preset interval replaces those records and every
 * chart and table below re-renders from the same filtered dataset.
 *
 * The charts are dependency-free inline SVG (no chart library is installed):
 * each has `role="img"` with a title/description for assistive technology, and
 * the daily table gives the same numbers in text form.
 */
import {
  barLayout,
  formatCompactValue,
  formatDayLabel,
  groupedBarLayout,
  labelStep,
  type DashboardMetrics,
} from '../../lib/dashboardMetrics';
import { formatAmount, formatLiters, formatSignedAmount } from './format';

const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 220;
const PADDING = { top: 14, right: 12, bottom: 34, left: 52 };
const INNER_WIDTH = VIEW_WIDTH - PADDING.left - PADDING.right;
const INNER_HEIGHT = VIEW_HEIGHT - PADDING.top - PADDING.bottom;

/** Y for a value at `fraction` (0 = baseline, 1 = top of the plot area). */
function axisY(fraction: number): number {
  return PADDING.top + INNER_HEIGHT * (1 - fraction);
}

function varianceClassName(value: number): string | undefined {
  if (value < 0) return 'review-variance-negative';
  if (value > 0) return 'review-variance-positive';
  return undefined;
}

function GridLines({ max }: { max: number }) {
  return (
    <>
      {[0, 0.5, 1].map((fraction) => (
        <g key={fraction}>
          <line
            className="chart-grid"
            x1={PADDING.left}
            x2={VIEW_WIDTH - PADDING.right}
            y1={axisY(fraction)}
            y2={axisY(fraction)}
          />
          <text
            className="chart-axis-text"
            x={PADDING.left - 8}
            y={axisY(fraction) + 3}
            textAnchor="end"
          >
            {formatCompactValue(max * fraction)}
          </text>
        </g>
      ))}
    </>
  );
}

/** Bars of daily meter volume in liters. */
export function VolumeTrendChart({ metrics }: { metrics: DashboardMetrics }) {
  const { days, axisMaxMeterVolume } = metrics;
  const max = axisMaxMeterVolume > 0 ? axisMaxMeterVolume : 1;
  const bars = barLayout(
    days.map((day) => day.meterVolume),
    max,
    INNER_WIDTH,
    INNER_HEIGHT
  );
  const step = labelStep(days.length);
  const first = days[0];
  const last = days[days.length - 1];
  const peak = days.reduce(
    (best, day) => (day.meterVolume > best.meterVolume ? day : best),
    days[0]
  );

  return (
    <figure className="chart-card">
      <figcaption>
        <strong>Daily meter volume</strong>
        <span>Liters dispensed per day</span>
      </figcaption>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-labelledby="volume-chart-title"
        aria-describedby="volume-chart-desc"
      >
        <title id="volume-chart-title">Daily meter volume in liters</title>
        <desc id="volume-chart-desc">
          {`Daily meter volume from ${formatDayLabel(first.date)} to ${formatDayLabel(last.date)}. Peak ${formatLiters(peak.meterVolume)} on ${formatDayLabel(peak.date)}.`}
        </desc>
        <GridLines max={max} />
        <line
          className="chart-baseline"
          x1={PADDING.left}
          x2={VIEW_WIDTH - PADDING.right}
          y1={axisY(0)}
          y2={axisY(0)}
        />
        {bars.map((bar, index) => (
          <rect
            key={days[index].date}
            className="chart-bar chart-bar-volume"
            x={PADDING.left + bar.x}
            y={PADDING.top + bar.y}
            width={bar.width}
            height={bar.height}
            rx={3}
            data-day={days[index].date}
            data-value={days[index].meterVolume}
          />
        ))}
        {bars.map((bar, index) =>
          index % step === 0 ? (
            <text
              key={`label-${days[index].date}`}
              className="chart-axis-text"
              x={PADDING.left + bar.x + bar.width / 2}
              y={VIEW_HEIGHT - 12}
              textAnchor="middle"
            >
              {formatDayLabel(days[index].date)}
            </text>
          ) : null
        )}
      </svg>
    </figure>
  );
}

/** Expected revenue vs reported cash per day, as side-by-side bars. */
export function RevenueTrendChart({ metrics }: { metrics: DashboardMetrics }) {
  const { days, totals, axisMaxRevenue } = metrics;
  const max = axisMaxRevenue > 0 ? axisMaxRevenue : 1;
  const groups = days.map((day) => [day.expectedRevenue, day.reportedCash]);
  const bars = groupedBarLayout(groups, max, INNER_WIDTH, INNER_HEIGHT);
  const step = labelStep(days.length);
  const first = days[0];
  const last = days[days.length - 1];
  const labels = ['Expected revenue', 'Reported cash'];

  return (
    <figure className="chart-card">
      <figcaption>
        <strong>Expected revenue vs reported cash</strong>
        <span>Per day, in amount</span>
      </figcaption>
      <p className="chart-legend">
        <span className="chart-swatch chart-swatch-expected" aria-hidden="true" />
        Expected
        <span className="chart-swatch chart-swatch-reported" aria-hidden="true" />
        Reported
      </p>
      <svg
        className="chart-svg"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-labelledby="revenue-chart-title"
        aria-describedby="revenue-chart-desc"
      >
        <title id="revenue-chart-title">
          Expected revenue vs reported cash per day
        </title>
        <desc id="revenue-chart-desc">
          {`Expected revenue ${formatAmount(totals.expectedRevenue)} against reported cash ${formatAmount(totals.reportedCash)} from ${formatDayLabel(first.date)} to ${formatDayLabel(last.date)}.`}
        </desc>
        <GridLines max={max} />
        <line
          className="chart-baseline"
          x1={PADDING.left}
          x2={VIEW_WIDTH - PADDING.right}
          y1={axisY(0)}
          y2={axisY(0)}
        />
        {bars.map((bar) => (
          <rect
            key={`${days[bar.groupIndex].date}-${bar.seriesIndex}`}
            className={`chart-bar chart-bar-${bar.seriesIndex === 0 ? 'expected' : 'reported'}`}
            x={PADDING.left + bar.x}
            y={PADDING.top + bar.y}
            width={bar.width}
            height={bar.height}
            rx={3}
            data-day={days[bar.groupIndex].date}
            data-series={labels[bar.seriesIndex]}
            data-value={
              bar.seriesIndex === 0
                ? days[bar.groupIndex].expectedRevenue
                : days[bar.groupIndex].reportedCash
            }
          />
        ))}
        {days.map((day, index) => {
          if (index % step !== 0) return null;
          const groupBars = bars.filter((bar) => bar.groupIndex === index);
          const start = groupBars[0];
          const end = groupBars[groupBars.length - 1];
          if (!start || !end) return null;
          return (
            <text
              key={`label-${day.date}`}
              className="chart-axis-text"
              x={PADDING.left + (start.x + end.x + end.width) / 2}
              y={VIEW_HEIGHT - 12}
              textAnchor="middle"
            >
              {formatDayLabel(day.date)}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}

/** Both charts; renders nothing when the selected range has no records. */
export function DashboardCharts({ metrics }: { metrics: DashboardMetrics }) {
  if (metrics.days.length === 0) return null;

  return (
    <div className="dashboard-charts">
      <VolumeTrendChart metrics={metrics} />
      <RevenueTrendChart metrics={metrics} />
    </div>
  );
}

/** Per-day metrics table with a totals row; the charts' text alternative. */
export function DailyMetricsTable({ metrics }: { metrics: DashboardMetrics }) {
  if (metrics.days.length === 0) {
    return <p className="logs-message">No records in the selected period.</p>;
  }

  const { days, totals } = metrics;

  return (
    <>
      <div className="logs-table-wrap">
        <table className="logs-table review-table dashboard-table">
          <caption className="visually-hidden">
            Daily totals for the selected date range
          </caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col" className="logs-num">
                Records
              </th>
              <th scope="col" className="logs-num">
                Meter volume
              </th>
              <th scope="col" className="logs-num">
                Expected revenue
              </th>
              <th scope="col" className="logs-num">
                Reported cash
              </th>
              <th scope="col" className="logs-num">
                Variance
              </th>
              <th scope="col" className="logs-num">
                Anomalies
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>
                  <time dateTime={day.date}>{formatDayLabel(day.date)}</time>
                </td>
                <td className="logs-num">{day.recordCount}</td>
                <td className="logs-num">{formatLiters(day.meterVolume)}</td>
                <td className="logs-num">{formatAmount(day.expectedRevenue)}</td>
                <td className="logs-num">{formatAmount(day.reportedCash)}</td>
                <td className="logs-num">
                  <span className={varianceClassName(day.variance)}>
                    {formatSignedAmount(day.variance)}
                  </span>
                </td>
                <td className="logs-num">{day.anomalyCount}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="logs-num">{totals.recordCount}</td>
              <td className="logs-num">{formatLiters(totals.meterVolume)}</td>
              <td className="logs-num">{formatAmount(totals.expectedRevenue)}</td>
              <td className="logs-num">{formatAmount(totals.reportedCash)}</td>
              <td className="logs-num">
                <span className={varianceClassName(totals.variance)}>
                  {formatSignedAmount(totals.variance)}
                </span>
              </td>
              <td className="logs-num">{totals.anomalyCount}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {metrics.skippedRecords > 0 && (
        <p className="logs-message review-note" role="status">
          {metrics.skippedRecords}{' '}
          {metrics.skippedRecords === 1 ? 'record has' : 'records have'} an
          unreadable timestamp and are not included in the daily totals.
        </p>
      )}
    </>
  );
}
