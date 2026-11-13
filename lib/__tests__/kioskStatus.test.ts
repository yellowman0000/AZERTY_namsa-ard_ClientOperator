import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
  formatHeartbeatAge,
  parseKioskFleet,
} from '../kioskStatus';

const payload = (overrides: Record<string, unknown> = {}) => ({
  count: 3,
  onlineCount: 1,
  staleAfterSeconds: 30,
  kiosks: [
    {
      kioskId: 'KIOSK-003',
      status: 'OFFLINE',
      lastHeartbeat: '2026-11-13T14:54:17.000Z',
      secondsSinceLastPing: 48,
    },
    {
      kioskId: 'KIOSK-001',
      status: 'ONLINE',
      lastHeartbeat: '2026-11-13T14:55:01.234Z',
      secondsSinceLastPing: 4,
    },
    {
      kioskId: 'KIOSK-004',
      status: 'OFFLINE',
      lastHeartbeat: null,
      secondsSinceLastPing: null,
    },
  ],
  ...overrides,
});

describe('parseKioskFleet', () => {
  it('parses the server payload and sorts kiosks by id', () => {
    const fleet = parseKioskFleet(payload());

    expect(fleet.staleAfterSeconds).toBe(30);
    expect(fleet.onlineCount).toBe(1);
    expect(fleet.kiosks.map((kiosk) => kiosk.kioskId)).toEqual([
      'KIOSK-001',
      'KIOSK-003',
      'KIOSK-004',
    ]);
    expect(fleet.kiosks[0]).toEqual({
      kioskId: 'KIOSK-001',
      status: 'ONLINE',
      lastHeartbeat: '2026-11-13T14:55:01.234Z',
      secondsSinceLastPing: 4,
    });
    expect(fleet.kiosks[2].secondsSinceLastPing).toBeNull();
    expect(fleet.kiosks[2].lastHeartbeat).toBeNull();
  });

  it('derives the online count and rounds the heartbeat age instead of trusting the payload', () => {
    const fleet = parseKioskFleet(
      payload({
        onlineCount: 99,
        kiosks: [
          { kioskId: 'KIOSK-001', status: 'ONLINE', secondsSinceLastPing: 4.6 },
          { kioskId: 'KIOSK-002', status: 'OFFLINE', secondsSinceLastPing: 31 },
        ],
      })
    );

    expect(fleet.onlineCount).toBe(1);
    expect(fleet.kiosks.map((kiosk) => kiosk.secondsSinceLastPing)).toEqual([5, 31]);
  });

  it('falls back to the default timeout when the server omits or invalidates it', () => {
    expect(parseKioskFleet(payload({ staleAfterSeconds: undefined })).staleAfterSeconds).toBe(
      DEFAULT_HEARTBEAT_TIMEOUT_SECONDS
    );
    expect(parseKioskFleet(payload({ staleAfterSeconds: -5 })).staleAfterSeconds).toBe(
      DEFAULT_HEARTBEAT_TIMEOUT_SECONDS
    );
  });

  it('accepts an empty fleet', () => {
    expect(parseKioskFleet({ kiosks: [] })).toEqual({
      staleAfterSeconds: DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
      onlineCount: 0,
      kiosks: [],
    });
  });

  it('rejects a body that is not an object', () => {
    expect(() => parseKioskFleet(null)).toThrow('was not an object');
    expect(() => parseKioskFleet('nope')).toThrow('was not an object');
  });

  it('rejects a body without a kiosk list', () => {
    expect(() => parseKioskFleet({ count: 3 })).toThrow(
      'did not contain a list of kiosks'
    );
  });

  it('rejects an entry without a kiosk id', () => {
    expect(() =>
      parseKioskFleet(payload({ kiosks: [{ status: 'ONLINE', secondsSinceLastPing: 4 }] }))
    ).toThrow('entry 1 is missing a kiosk id');
    expect(() =>
      parseKioskFleet(payload({ kiosks: [{ kioskId: '  ', status: 'ONLINE' }] }))
    ).toThrow('entry 1 is missing a kiosk id');
  });

  it('rejects an unknown status', () => {
    expect(() =>
      parseKioskFleet(payload({ kiosks: [{ kioskId: 'KIOSK-001', status: 'ONLNE' }] }))
    ).toThrow('entry 1 has an invalid status');
  });

  it('rejects an unreadable heartbeat age', () => {
    expect(() =>
      parseKioskFleet(
        payload({ kiosks: [{ kioskId: 'KIOSK-001', status: 'ONLINE', secondsSinceLastPing: -1 }] })
      )
    ).toThrow('entry 1 has an invalid heartbeat age');
    expect(() =>
      parseKioskFleet(
        payload({ kiosks: [{ kioskId: 'KIOSK-001', status: 'ONLINE', secondsSinceLastPing: '4' }] })
      )
    ).toThrow('entry 1 has an invalid heartbeat age');
  });

  it('rejects a non-string last heartbeat', () => {
    expect(() =>
      parseKioskFleet(payload({ kiosks: [{ kioskId: 'KIOSK-001', status: 'ONLINE', lastHeartbeat: 42 }] }))
    ).toThrow('entry 1 has an invalid last heartbeat');
  });
});

describe('formatHeartbeatAge', () => {
  it('formats seconds, minutes, hours and days', () => {
    expect(formatHeartbeatAge(0)).toBe('0s ago');
    expect(formatHeartbeatAge(4)).toBe('4s ago');
    expect(formatHeartbeatAge(59)).toBe('59s ago');
    expect(formatHeartbeatAge(60)).toBe('1m ago');
    expect(formatHeartbeatAge(3_599)).toBe('59m ago');
    expect(formatHeartbeatAge(3_600)).toBe('1h ago');
    expect(formatHeartbeatAge(86_399)).toBe('23h ago');
    expect(formatHeartbeatAge(86_400)).toBe('1d ago');
  });

  it('says "never" without a heartbeat and clamps negative ages', () => {
    expect(formatHeartbeatAge(null)).toBe('never');
    expect(formatHeartbeatAge(Number.NaN)).toBe('never');
    expect(formatHeartbeatAge(-5)).toBe('0s ago');
  });

  it('rounds fractional ages', () => {
    expect(formatHeartbeatAge(4.6)).toBe('5s ago');
  });
});
