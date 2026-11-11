import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComparisonChart } from '../../app/manager/comparison-chart';
import {
  OverviewPanel,
  SocialAssistancePanel,
  StakeholderSummaryCards,
} from '../../app/manager/stakeholder-analytics-view';
import {
  buildSocialAssistanceComparison,
  type StakeholderAnalytics,
  type StakeholderComparisonDatum,
} from '../stakeholderAnalytics';

const analytics: StakeholderAnalytics = {
  month: '2026-10',
  summaryCards: {
    totalGrossRevenue: 45000,
    outstandingUncollectedCash: 1250,
    waterLossPercentage: 2.78,
  },
  socialAssistanceChart: {
    subsidizedVolumeLiters: 8500,
    commercialSalesVolumeLiters: 22500,
  },
};

const socialData = buildSocialAssistanceComparison(analytics.socialAssistanceChart);

const formatLitersForTest = (value: number) => `${value} L`;

describe('StakeholderSummaryCards', () => {
  it('shows the three monthly KPI cards', () => {
    const html = renderToStaticMarkup(
      <StakeholderSummaryCards summary={analytics.summaryCards} />
    );

    expect(html).toContain('Total gross revenue');
    expect(html).toContain('Outstanding uncollected cash');
    expect(html).toContain('Water loss');
    expect(html).toContain('2.78%');
    expect(html).toContain('role="group"');
  });

  it('draws attention to outstanding cash', () => {
    const withCash = renderToStaticMarkup(
      <StakeholderSummaryCards summary={analytics.summaryCards} />
    );
    const withoutCash = renderToStaticMarkup(
      <StakeholderSummaryCards
        summary={{ ...analytics.summaryCards, outstandingUncollectedCash: 0 }}
      />
    );

    expect(withCash).toContain('review-summary-card-alert');
    expect(withoutCash).not.toContain('review-summary-card-alert');
  });
});

describe('ComparisonChart', () => {
  it('draws side-by-side columns with their values and shares', () => {
    const html = renderToStaticMarkup(
      <ComparisonChart
        idPrefix="social-comparison"
        title="Subsidized vs commercial volume"
        description="Liters dispensed by water tier"
        data={socialData}
        formatValue={formatLitersForTest}
      />
    );

    expect(html).toContain('role="img"');
    expect(html).toContain('<title id="social-comparison-title">');
    expect(html).toContain('aria-describedby="social-comparison-description"');
    expect(html).toContain('data-key="subsidized"');
    expect(html).toContain('data-value="8500"');
    expect(html).toContain('data-key="commercial"');
    expect(html).toContain('data-value="22500"');
    expect(html).toContain('Subsidized');
    expect(html).toContain('Commercial');
    expect(html).toContain('27.4%');
    expect(html).toContain('72.6%');
    expect(html).toContain('22500 L');
  });

  it('renders the empty message when both values are zero', () => {
    const zeroData: StakeholderComparisonDatum[] = socialData.map((datum) => ({
      ...datum,
      value: 0,
      share: 0,
    }));
    const html = renderToStaticMarkup(
      <ComparisonChart
        idPrefix="social-comparison"
        title="Subsidized vs commercial volume"
        description="Liters dispensed by water tier"
        data={zeroData}
        formatValue={formatLitersForTest}
      />
    );

    expect(html).toContain('No values were recorded for this month.');
    expect(html).not.toContain('role="img"');
  });

  it('accepts a custom empty message', () => {
    const html = renderToStaticMarkup(
      <ComparisonChart
        idPrefix="cash-comparison"
        title="Cash"
        description="Cash comparison"
        data={[]}
        formatValue={formatLitersForTest}
        emptyMessage="Nothing to compare."
      />
    );

    expect(html).toContain('Nothing to compare.');
  });
});

describe('analytics tabs content', () => {
  it('OverviewPanel compares gross revenue with uncollected cash', () => {
    const html = renderToStaticMarkup(<OverviewPanel analytics={analytics} />);

    expect(html).toContain('Gross revenue vs uncollected cash');
    expect(html).toContain('data-key="gross-revenue"');
    expect(html).toContain('data-key="uncollected-cash"');
    expect(html).toContain('Water loss for October 2026 is');
    expect(html).toContain('2.78%');
  });

  it('SocialAssistancePanel compares subsidized and commercial volume', () => {
    const html = renderToStaticMarkup(
      <SocialAssistancePanel analytics={analytics} />
    );

    expect(html).toContain('Subsidized vs commercial volume');
    expect(html).toContain('data-value="8500"');
    expect(html).toContain('data-value="22500"');
    expect(html).toContain('Social assistance compares the subsidized volume');
    expect(html).toContain('against commercial sales');
  });
});
