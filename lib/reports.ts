/**
 * Report export client (Story 07).
 *
 * Calls `GET /api/kiosk/reports/export?format=csv|pdf&startDate=…&endDate=…`
 * and saves the returned stream as a file. The URL builder and the header
 * parsing are pure so they can be tested without a browser.
 */
import { rangeToQuery, type DateRange } from './dateRange';

export const REPORTS_EXPORT_PATH = '/api/kiosk/reports/export';

export type ReportFormat = 'csv' | 'pdf';

export function buildReportUrl(format: ReportFormat, range: DateRange): string {
  const params = new URLSearchParams({ format, ...rangeToQuery(range) });
  return `${REPORTS_EXPORT_PATH}?${params.toString()}`;
}

/** Reads the filename from `Content-Disposition: attachment; filename="…"`. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  const name = quoted?.[1]?.trim();
  return name ? decodeURIComponent(name) : null;
}

/** Fallback when the server does not send a filename. */
export function fallbackReportFilename(
  format: ReportFormat,
  range: DateRange
): string {
  const { startDate, endDate } = rangeToQuery(range);
  const suffix =
    startDate && endDate
      ? `${startDate}_${endDate}`
      : new Date().toISOString().slice(0, 10);
  return `kiosk-report-${suffix}.${format}`;
}

export interface DownloadReportOptions {
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  clickDownload?: (url: string, filename: string) => void;
}

export interface DownloadedReport {
  filename: string;
  bytes: number;
}

function defaultClickDownload(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Downloads the export as a file. Throws a readable error when the server
 * rejects the request (for example an invalid date range).
 */
export async function downloadReport(
  format: ReportFormat,
  range: DateRange,
  options: DownloadReportOptions = {}
): Promise<DownloadedReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const createObjectUrl =
    options.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectUrl =
    options.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const clickDownload = options.clickDownload ?? defaultClickDownload;

  const response = await fetchImpl(buildReportUrl(format, range));
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === 'string') detail = body.message;
    } catch {
      // Non-JSON error body; the status is enough.
    }
    throw new Error(detail || `Report export failed (HTTP ${response.status}).`);
  }

  const blob = await response.blob();
  const filename =
    filenameFromDisposition(response.headers.get('content-disposition')) ??
    fallbackReportFilename(format, range);

  const objectUrl = createObjectUrl(blob);
  try {
    clickDownload(objectUrl, filename);
  } finally {
    revokeObjectUrl(objectUrl);
  }

  return { filename, bytes: blob.size };
}
