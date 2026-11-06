import { afterEach, describe, expect, it } from 'bun:test';
import { prepareEvidencePhoto, shouldDownscale } from '../evidenceImage';

const makeFile = (size: number, name = 'meter.jpg', type = 'image/jpeg') =>
  new File([new Uint8Array(size)], name, { type });

const originalCreateImageBitmap = (globalThis as Record<string, unknown>)
  .createImageBitmap;
const originalOffscreenCanvas = (globalThis as Record<string, unknown>)
  .OffscreenCanvas;

afterEach(() => {
  (globalThis as Record<string, unknown>).createImageBitmap =
    originalCreateImageBitmap;
  (globalThis as Record<string, unknown>).OffscreenCanvas =
    originalOffscreenCanvas;
});

describe('shouldDownscale', () => {
  it('leaves photos at or below the threshold alone', () => {
    expect(shouldDownscale({ size: 300 * 1024 })).toBe(false);
    expect(shouldDownscale({ size: 700 * 1024 })).toBe(false);
  });

  it('asks for a downscale above the threshold', () => {
    expect(shouldDownscale({ size: 700 * 1024 + 1 })).toBe(true);
    expect(shouldDownscale({ size: 4 * 1024 * 1024 })).toBe(true);
  });
});

describe('prepareEvidencePhoto', () => {
  it('returns small photos untouched', async () => {
    const small = makeFile(200 * 1024);

    const result = await prepareEvidencePhoto(small);

    expect(result).toBe(small);
  });

  it('falls back to the original when the browser cannot resize', async () => {
    // bun has no createImageBitmap, which mirrors an old/unsupported browser.
    const large = makeFile(3 * 1024 * 1024);

    const result = await prepareEvidencePhoto(large);

    expect(result).toBe(large);
  });

  it('re-encodes a large photo to a smaller JPEG and keeps the base name', async () => {
    (globalThis as Record<string, unknown>).createImageBitmap = async () => ({
      width: 3000,
      height: 2000,
      close: () => {},
    });
    (globalThis as Record<string, unknown>).OffscreenCanvas = class {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return { drawImage: () => {} };
      }
      async convertToBlob() {
        return new Blob([new Uint8Array(120 * 1024)], {
          type: 'image/jpeg',
        });
      }
    };

    const original = makeFile(3 * 1024 * 1024, 'meter.PNG', 'image/png');

    const result = await prepareEvidencePhoto(original);

    expect(result).not.toBe(original);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('meter.jpg');
    expect(result.size).toBeLessThan(original.size);
  });
});
