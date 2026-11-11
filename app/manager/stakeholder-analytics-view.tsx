'use client';

/**
 * Stakeholder analytics view (Story 09, frontend task).
 *
 * Operation Managers and stakeholders get monthly summary cards (gross
 * revenue, outstanding uncollected cash and water loss) plus a tabbed area:
 * the Social Assistance tab renders the required side-by-side chart comparing
 * subsidized and commercial dispensed volume.
 *
 * The aggregation is computed by the server (Story 09 backend task,
 * `GET /api/kiosk/analytics/stakeholder`); this view only validates and
 * presents its payload. When the endpoint is unavailable the error is shown
 * inline with a retry action instead of empty cards.
 */
import { useState } from 'react';
import Link from 'next/link';
import {
  buildCashComparison,
  buildSocialAssistanceComparison,
  currentMonthKey,
  formatMonthLabel,
  type StakeholderAnalytics,
  type StakeholderSummary,
} from '../../lib/stakeholderAnalytics';
import { useStakeholderAnalytics } from '../../lib/useStakeholderAnalytics';
import { ComparisonChart } from './comparison-chart';
import { formatAmount, formatLiters } from './format';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'social', label: 'Social Assistance' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function formatPercentageValue(value: number): string {
  return `${value.toFixed(2)}%`;
}

/** The three monthly KPI cards. */
export function StakeholderSummaryCards({
  summary,
}: {
  summary: StakeholderSummary;
}) {
  const uncollectedTone =
    summary.outstandingUncollectedCash > 0 ? ' review-summary-card-alert' : '';

  return (
    <div className="review-summary" role="group" aria-label="Stakeholder summary">
      <div className="review-summary-card">
        <span className="review-summary-label">Total gross revenue</span>
        <strong>{formatAmount(summary.totalGrossRevenue)}</strong>
        <span className="review-summary-hint">collected and expected for the month</span>
      </div>
      <div className={`review-summary-card${uncollectedTone}`}>
        <span className="review-summary-label">Outstanding uncollected cash</span>
        <strong>{formatAmount(summary.outstandingUncollectedCash)}</strong>
        <span className="review-summary-hint">cash still short of expected revenue</span>
      </div>
      <div className="review-summary-card">
        <span className="review-summary-label">Water loss</span>
        <strong>{formatPercentageValue(summary.waterLossPercentage)}</strong>
        <span className="review-summary-hint">of the month&apos;s dispensed volume</span>
      </div>
    </div>
  );
}

/** Overview tab: gross revenue against the cash that is still outstanding. */
export function OverviewPanel({
  analytics,
}: {
  analytics: StakeholderAnalytics;
}) {
  return (
    <>
      <ComparisonChart
        idPrefix="cash-comparison"
        title="Gross revenue vs uncollected cash"
        description="The month's gross revenue compared with the cash still outstanding"
        data={buildCashComparison(analytics.summaryCards)}
        formatValue={formatAmount}
        emptyMessage="No revenue was recorded for this month."
      />
      <p className="analytics-note">
        Water loss for {formatMonthLabel(analytics.month)} is{' '}
        {formatPercentageValue(analytics.summaryCards.waterLossPercentage)} of the
        dispensed volume.
      </p>
    </>
  );
}

/** Social Assistance tab: the required subsidized-vs-commercial comparison. */
export function SocialAssistancePanel({
  analytics,
}: {
  analytics: StakeholderAnalytics;
}) {
  const chart = analytics.socialAssistanceChart;

  return (
    <>
      <ComparisonChart
        idPrefix="social-comparison"
        title="Subsidized vs commercial volume"
        description="Liters dispensed in the selected month, by water tier"
        data={buildSocialAssistanceComparison(chart)}
        formatValue={formatLiters}
        emptyMessage="No subsidized or commercial volume was recorded for this month."
      />
      <p className="analytics-note">
        Social assistance compares the subsidized volume (
        {formatLiters(chart.subsidizedVolumeLiters)}) against commercial sales (
        {formatLiters(chart.commercialSalesVolumeLiters)}).
      </p>
    </>
  );
}

/**
 * `/manager/stakeholder-analytics`: monthly stakeholder analytics with a month
 * picker, the three KPI cards and the Overview / Social Assistance tabs.
 */
export default function StakeholderAnalyticsView() {
  const { month, analytics, loading, refreshing, error, selectMonth, refresh } =
    useStakeholderAnalytics();
  const [tab, setTab] = useState<TabKey>('overview');

  const showContent = analytics !== null && error === null;

  return (
    <main className="operator-shell">
      <header className="operator-topbar">
        <Link className="brand" href="/" aria-label="Nam Sa-ard operator console">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" role="presentation">
              <path d="M24 7C19 15 12 22 12 29a12 12 0 0 0 24 0C36 22 29 15 24 7Z" />
              <path className="brand-wave" d="M13 32c4-3 7 3 11 0s7 3 11 0" />
            </svg>
          </span>
          <span className="brand-name">namsa-ard</span>
          <span className="brand-subtitle">Operator console</span>
        </Link>
        <nav className="topbar-actions" aria-label="Manager views">
          <Link className="nav-link" href="/">
            Daily submission
          </Link>
          <Link className="nav-link" href="/manager">
            Historical logs
          </Link>
          <Link className="nav-link" href="/manager/operations-review">
            Operations review
          </Link>
        </nav>
      </header>

      <section className="operator-dashboard">
        <div className="operator-heading">
          <div>
            <p className="eyebrow">STAKEHOLDER · MONTHLY</p>
            <h1>Stakeholder analytics</h1>
            <p className="heading-copy">
              Monthly revenue, outstanding cash, water loss and Social Assistance volumes,
              aggregated by the server for the month you select.
            </p>
          </div>
        </div>

        <div className="review-controls analytics-controls">
          <label className="review-date-field" htmlFor="analytics-month">
            Month
            <input
              id="analytics-month"
              type="month"
              value={month}
              max={currentMonthKey()}
              disabled={loading}
              onChange={(event) => selectMonth(event.target.value)}
            />
          </label>
          <div className="review-actions">
            {refreshing && (
              <span className="logs-count" role="status">
                Updating…
              </span>
            )}
            <button
              className="button button-secondary"
              type="button"
              onClick={refresh}
              disabled={loading}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="logs-message logs-message-error" role="alert">
            <p>Could not load stakeholder analytics. {error}</p>
            <button className="button button-secondary" type="button" onClick={refresh}>
              Try again
            </button>
          </div>
        ) : loading && analytics === null ? (
          <p className="logs-message" role="status">
            Loading stakeholder analytics…
          </p>
        ) : showContent ? (
          <>
            <p className="analytics-month" aria-live="polite">
              Showing {formatMonthLabel(analytics.month)}
            </p>
            <StakeholderSummaryCards summary={analytics.summaryCards} />

            <section
              className="logs-card analytics-card"
              aria-labelledby="analytics-title"
            >
              <div className="logs-card-heading">
                <h2 id="analytics-title">Monthly breakdown</h2>
                <span className="logs-count">{formatMonthLabel(analytics.month)}</span>
              </div>

              <div
                className="analytics-tabs"
                role="tablist"
                aria-label="Stakeholder analytics views"
              >
                {TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    id={`analytics-tab-${key}`}
                    className={`analytics-tab${tab === key ? ' analytics-tab-active' : ''}`}
                    aria-selected={tab === key}
                    aria-controls={`analytics-panel-${key}`}
                    onClick={() => setTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'overview' ? (
                <div
                  role="tabpanel"
                  id="analytics-panel-overview"
                  aria-labelledby="analytics-tab-overview"
                  className="analytics-panel"
                >
                  <OverviewPanel analytics={analytics} />
                </div>
              ) : (
                <div
                  role="tabpanel"
                  id="analytics-panel-social"
                  aria-labelledby="analytics-tab-social"
                  className="analytics-panel"
                >
                  <SocialAssistancePanel analytics={analytics} />
                </div>
              )}
            </section>
          </>
        ) : null}
      </section>

      <footer className="operator-footer">
        <span>Nam Sa-ard · Stakeholder</span>
        <span>Monthly analytics</span>
      </footer>
    </main>
  );
}
