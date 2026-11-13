import { describe, expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { KioskStatusStrip } from '../../app/manager/kiosk-status-strip';
import type { KioskStatusRecord } from '../kioskStatus';

const kiosk = (overrides: Partial<KioskStatusRecord> = {}): KioskStatusRecord => ({
  kioskId: 'KIOSK-001',
  status: 'ONLINE',
  lastHeartbeat: '2026-11-13T14:55:01.234Z',
  secondsSinceLastPing: 4,
  ...overrides,
});

const renderStrip = (
  overrides: Partial<Parameters<typeof KioskStatusStrip>[0]> = {}
) =>
  renderToStaticMarkup(
    <KioskStatusStrip
      kiosks={[kiosk()]}
      onlineCount={1}
      staleAfterSeconds={30}
      updatedAt={null}
      loading={false}
      error={null}
      onRefresh={() => {}}
      {...overrides}
    />
  );

describe('KioskStatusStrip', () => {
  it('renders the section heading, copy and refresh control', () => {
    const html = renderStrip();

    expect(html).toContain('id="kiosk-status-title"');
    expect(html).toContain('Kiosk status');
    expect(html).toContain('OFFLINE after 30 seconds');
    expect(html).toContain('Refresh');
    expect(html).toContain('aria-label="Kiosk fleet status"');
  });

  it('renders one card per kiosk with status, heartbeat age and online summary', () => {
    const html = renderStrip({
      kiosks: [
        kiosk({ kioskId: 'KIOSK-001', status: 'ONLINE', secondsSinceLastPing: 4 }),
        kiosk({ kioskId: 'KIOSK-002', status: 'ONLINE', secondsSinceLastPing: 19 }),
        kiosk({ kioskId: 'KIOSK-003', status: 'OFFLINE', secondsSinceLastPing: 48 }),
      ],
      onlineCount: 2,
    });

    expect(html).toContain('2 of 3 online');
    expect(html).toContain('KIOSK-001');
    expect(html).toContain('KIOSK-002');
    expect(html).toContain('KIOSK-003');
    expect(html).toContain('ONLINE');
    expect(html).toContain('OFFLINE');
    expect(html).toContain('(4s ago)');
    expect(html).toContain('(19s ago)');
    expect(html).toContain('(48s ago)');
    expect(html).toContain('kiosk-card-online');
    expect(html).toContain('kiosk-card-offline');
    expect(html).toContain('Last heartbeat');
  });

  it('shows "(never)" for a kiosk that has not pinged yet', () => {
    const html = renderStrip({
      kiosks: [kiosk({ secondsSinceLastPing: null, lastHeartbeat: null, status: 'OFFLINE' })],
      onlineCount: 0,
    });

    expect(html).toContain('(never)');
    expect(html).toContain('No heartbeat recorded yet');
  });

  it('renders the loading state before the first answer', () => {
    const html = renderStrip({ loading: true, kiosks: [], onlineCount: 0 });

    expect(html).toContain('Loading kiosk status…');
    expect(html).not.toContain('kiosk-card-id');
  });

  it('renders the empty fleet state', () => {
    const html = renderStrip({ kiosks: [], onlineCount: 0 });

    expect(html).toContain('No kiosks have registered a heartbeat yet.');
    expect(html).not.toContain('kiosk-card');
  });

  it('renders the error state with a retry when nothing is on screen', () => {
    const html = renderStrip({
      kiosks: [],
      onlineCount: 0,
      error: 'The server answered 500.',
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not load kiosk status.');
    expect(html).toContain('The server answered 500.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('kiosk-card');
  });

  it('keeps the last known cards when a refresh fails', () => {
    const html = renderStrip({
      kiosks: [kiosk({ kioskId: 'KIOSK-001' })],
      onlineCount: 1,
      error: 'Could not reach the server.',
    });

    expect(html).toContain('Could not refresh kiosk status.');
    expect(html).toContain('KIOSK-001');
    expect(html).toContain('(4s ago)');
  });

  it('shows when the snapshot was updated', () => {
    const html = renderStrip({ updatedAt: Date.UTC(2026, 10, 13, 15, 4, 31) });

    expect(html).toContain('kiosk-status-updated');
    expect(html).toContain('Updated ');
  });
});
