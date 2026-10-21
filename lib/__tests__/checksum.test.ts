import { describe, it, expect } from 'bun:test';
import {
  generatePayloadChecksum,
  canonicalizePayload,
  verifyPayloadChecksum,
  attachChecksumToPayload,
  generatePayloadHash,
  CURRENT_CHECKSUM_VERSION,
} from '../checksum';

describe('Story 14-2 Subtask 1: Checksum & Hash Generator (Ball)', () => {
  const basePayload = {
    transaction_id: 'TXN-98765-TEST',
    kiosk_id: 'KIOSK-001',
    meter_volume: 42.5,
    recorded_at: '2026-10-17T12:00:00.000Z',
  };

  describe('Deterministic Hashing', () => {
    it('produces the exact same checksum regardless of object key order', async () => {
      const payloadOrderA = {
        transaction_id: 'TXN-001',
        kiosk_id: 'KIOSK-001',
        meter_volume: 15.75,
        recorded_at: '2026-10-17T10:00:00.000Z',
      };

      const payloadOrderB = {
        recorded_at: '2026-10-17T10:00:00.000Z',
        meter_volume: 15.75,
        kiosk_id: 'KIOSK-001',
        transaction_id: 'TXN-001',
      };

      const hashA = await generatePayloadChecksum(payloadOrderA);
      const hashB = await generatePayloadChecksum(payloadOrderB);

      expect(hashA.checksum).toBe(hashB.checksum);
      expect(hashA.canonicalString).toBe(hashB.canonicalString);
      expect(hashA.checksum).toHaveLength(64); // SHA-256 hex string length
    });

    it('normalizes float meter volume deterministically', async () => {
      const p1 = { ...basePayload, meter_volume: 42.5 };
      const p2 = { ...basePayload, meter_volume: 42.50000 };

      const h1 = await generatePayloadChecksum(p1);
      const h2 = await generatePayloadChecksum(p2);

      expect(h1.checksum).toBe(h2.checksum);
      expect(h1.canonicalString).toContain('meter:42.5000');
    });

    it('normalizes timestamps to ISO-8601 UTC representation', async () => {
      const p1 = { ...basePayload, recorded_at: '2026-10-17T12:00:00.000Z' };
      const p2 = { ...basePayload, recorded_at: new Date('2026-10-17T12:00:00.000Z').toString() };

      const h1 = await generatePayloadChecksum(p1);
      const h2 = await generatePayloadChecksum(p2);

      expect(h1.checksum).toBe(h2.checksum);
    });

    it('handles both camelCase and snake_case properties consistently', async () => {
      const snake = {
        transaction_id: 'TXN-SNAKE',
        kiosk_id: 'KIOSK-1',
        meter_volume: 50.0,
        recorded_at: '2026-10-17T10:00:00.000Z',
      };

      const camel = {
        transactionId: 'TXN-SNAKE',
        kioskId: 'KIOSK-1',
        meterVolume: 50.0,
        recordedAt: '2026-10-17T10:00:00.000Z',
      };

      const hashSnake = await generatePayloadChecksum(snake);
      const hashCamel = await generatePayloadChecksum(camel);

      expect(hashSnake.checksum).toBe(hashCamel.checksum);
      expect(hashSnake.canonicalString).toBe(hashCamel.canonicalString);
    });
  });

  describe('Documented Algorithm & Versioning', () => {
    it('uses v1 as default algorithm version with pipe-delimited canonical format', async () => {
      expect(CURRENT_CHECKSUM_VERSION).toBe('v1');

      const canonical = canonicalizePayload(basePayload, 'v1');
      expect(canonical).toBe(
        'v1|kiosk:KIOSK-001|meter:42.5000|recorded:2026-10-17T12:00:00.000Z|txn:TXN-98765-TEST'
      );
    });

    it('supports version-prefixed checksum when requested', async () => {
      const result = await generatePayloadChecksum(basePayload, { prefixVersion: true });
      expect(result.checksum.startsWith('v1:')).toBe(true);
      expect(result.checksum.length).toBe(3 + 64);
    });

    it('supports legacy algorithm mode for backward compatibility', async () => {
      const legacyCanonical = canonicalizePayload(basePayload, 'legacy');
      expect(legacyCanonical).toBe('TXN-98765-TESTKIOSK-00142.5');

      const legacyHash = await generatePayloadHash(
        basePayload.transaction_id,
        basePayload.kiosk_id,
        basePayload.meter_volume
      );
      expect(legacyHash).toHaveLength(64);

      const legacyResult = await generatePayloadChecksum(basePayload, { version: 'legacy' });
      expect(legacyResult.checksum).toBe(legacyHash);
    });
  });

  describe('Stored Alongside Cached Payload', () => {
    it('attaches checksum, checksum_version, and cached_at to the payload', async () => {
      const cached = await attachChecksumToPayload(basePayload);

      expect(cached.transaction_id).toBe(basePayload.transaction_id);
      expect(cached.meter_volume).toBe(basePayload.meter_volume);
      expect(cached.checksum).toBeDefined();
      expect(cached.checksum).toHaveLength(64);
      expect(cached.checksum_version).toBe('v1');
      expect(cached.cached_at).toBeDefined();
      expect(new Date(cached.cached_at).getTime()).toBeGreaterThan(0);
    });
  });

  describe('Offline Data Corruption Detection', () => {
    it('verifies valid uncorrupted payload successfully', async () => {
      const cached = await attachChecksumToPayload(basePayload);
      const verification = await verifyPayloadChecksum(cached);

      expect(verification.isValid).toBe(true);
      expect(verification.computedChecksum).toBe(cached.checksum);
    });

    it('detects corrupted meter_volume', async () => {
      const cached = await attachChecksumToPayload(basePayload);

      // Simulating offline data corruption / tampering
      const corrupted = { ...cached, meter_volume: 999.99 };
      const verification = await verifyPayloadChecksum(corrupted);

      expect(verification.isValid).toBe(false);
      expect(verification.error).toContain('Checksum mismatch');
    });

    it('detects corrupted transaction_id or kiosk_id', async () => {
      const cached = await attachChecksumToPayload(basePayload);

      const corruptedTxn = { ...cached, transaction_id: 'TXN-TAMPERED' };
      expect((await verifyPayloadChecksum(corruptedTxn)).isValid).toBe(false);

      const corruptedKiosk = { ...cached, kiosk_id: 'KIOSK-ROGUE' };
      expect((await verifyPayloadChecksum(corruptedKiosk)).isValid).toBe(false);
    });

    it('verifies legacy checksums correctly without failure', async () => {
      const legacyHash = await generatePayloadHash(
        basePayload.transaction_id,
        basePayload.kiosk_id,
        basePayload.meter_volume
      );

      const payloadWithLegacy = {
        ...basePayload,
        checksum: legacyHash,
      };

      const verification = await verifyPayloadChecksum(payloadWithLegacy);
      expect(verification.isValid).toBe(true);
      expect(verification.version).toBe('legacy');
    });
  });
});
