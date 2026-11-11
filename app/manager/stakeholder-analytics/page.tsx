import { Suspense } from 'react';
import StakeholderAnalyticsView from '../stakeholder-analytics-view';

export const metadata = {
  title: 'Nam Sa-ard | Stakeholder analytics',
  description:
    'Monthly stakeholder analytics: gross revenue, uncollected cash, water loss and subsidized vs commercial volume.',
};

/**
 * The view reads the current month for its default month picker, so it is a
 * dynamic client component; the Suspense boundary lets the rest of the route
 * prerender while the current month resolves.
 */
export default function StakeholderAnalyticsPage() {
  return (
    <Suspense
      fallback={
        <main className="operator-shell">
          <p className="logs-message" role="status">
            Loading stakeholder analytics…
          </p>
        </main>
      }
    >
      <StakeholderAnalyticsView />
    </Suspense>
  );
}
