const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.82;
/** Below this size a photo is already cheap to upload, so leave it untouched. */
const SKIP_BELOW_BYTES = 700 * 1024;

export function shouldDownscale(file: { size: number }): boolean {
  return file.size > SKIP_BELOW_BYTES;
}

function toJpegName(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg';
}

function createCanvas(
  width: number,
  height: number
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas as HTMLCanvasElement;
}

function toJpegBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement
): Promise<Blob | null> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }
  return new Promise((resolve) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => resolve(blob),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

/**
 * Shrinks a phone photo before it is queued or uploaded.
 *
 * A 3–4 MB camera photo takes around a minute to reach imgBB on a mobile link,
 * which is long enough for the upload to time out mid-sync. Re-encoding to a
 * 1600 px JPEG drops it to a few hundred kilobytes. Any failure (old browser,
 * unsupported codec, zero-sized image) falls back to the original file so
 * evidence is never lost.
 */
export async function prepareEvidencePhoto(file: File): Promise<File> {
  if (!shouldDownscale(file)) return file;
  if (typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const longestEdge = Math.max(bitmap.width, bitmap.height) || 1;
    const scale = longestEdge > MAX_EDGE_PX ? MAX_EDGE_PX / longestEdge : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d') as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!context) return file;

    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await toJpegBlob(canvas);
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], toJpegName(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  } finally {
    bitmap?.close?.();
  }
}
