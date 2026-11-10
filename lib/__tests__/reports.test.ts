import { describe, expect, it } from 'bun:test';
import {
  REPORTS_EXPORT_PATH,
  buildReportUrl,
  downloadReport,
  fallbackReportFilename,
  filenameFromDisposition,
} from '../reports';
import type { DateRange } from '../dateRange';

const range: DateRange = { startDate: '2026-11-01', endDate: '2026-11-07' };

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

describe('buildReportUrl', () => {
  it('includes the format plus both bounds', () => {
    const url = buildReportUrl('csv', range);
    expect(url.startsWith(`${REPORTS_EXPORT_PATH}?`)).toBe(true);
    expect(url).toContain('format=csv');
    expect(url).toContain('startDate=2026-11-01');
    expect(url).toContain('endDate=2026-11-07');
  });

  it('omits bounds when no filter is active', () => {
    expect(buildReportUrl('pdf', { startDate: '', endDate: '' })).toBe(
      `${REPORTS_EXPORT_PATH}?format=pdf`
    );
  });
});

describe('filenameFromDisposition', () => {
  it('reads a quoted filename', () => {
    expect(
      filenameFromDisposition('attachment; filename="kiosk-report-2026-11.csv"')
    ).toBe('kiosk-report-2026-11.csv');
  });

  it('reads an unquoted filename and decodes escapes', () => {
    expect(filenameFromDisposition('attachment; filename=kiosk%20report.csv')).toBe(
      'kiosk report.csv'
    );
  });

  it('returns null for a missing header', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('attachment')).toBeNull();
  });
});

describe('fallbackReportFilename', () => {
  it('uses the applied range and the format', () => {
    expect(fallbackReportFilename('pdf', range)).toBe(
      'kiosk-report-2026-11-01_2026-11-07.pdf'
    );
  });
});

describe('downloadReport', () => {
  it('saves the exported file under the server-provided name', async () => {
    const clicked: Array<{ url: string; filename: string }> = [];
    const revoked: string[] = [];
    let requestedUrl = '';

    const result = await downloadReport('csv', range, {
      fetchImpl: (async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response('Total volume,10\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition':
              'attachment; filename="kiosk-report-2026-11.csv"',
          },
        });
      }) as typeof fetch,
      createObjectUrl: () => 'blob:report',
      revokeObjectUrl: (url) => revoked.push(url),
      clickDownload: (url, filename) => clicked.push({ url, filename }),
    });

    expect(requestedUrl).toContain('format=csv');
    expect(result).toEqual({ filename: 'kiosk-report-2026-11.csv', bytes: 16 });
    expect(clicked).toEqual([
      { url: 'blob:report', filename: 'kiosk-report-2026-11.csv' },
    ]);
    expect(revoked).toEqual(['blob:report']);
  });

  it('falls back to a generated filename', async () => {
    const clicked: Array<{ url: string; filename: string }> = [];

    const result = await downloadReport('pdf', range, {
      fetchImpl: (async () =>
        new Response('%PDF-1.4', { status: 200 })) as typeof fetch,
      createObjectUrl: () => 'blob:pdf',
      revokeObjectUrl: () => {},
      clickDownload: (url, filename) => clicked.push({ url, filename }),
    });

    expect(result.filename).toBe('kiosk-report-2026-11-01_2026-11-07.pdf');
    expect(clicked[0].filename).toBe(result.filename);
  });

  it('surfaces the server message for a rejected range', async () => {
    await expect(
      downloadReport('csv', { startDate: '2026-11-30', endDate: '2026-11-01' }, {
        fetchImpl: (async () =>
          jsonResponse(
            { message: 'startDate must not be after endDate' },
            { status: 400 }
          )) as typeof fetch,
        createObjectUrl: () => 'blob:x',
        revokeObjectUrl: () => {},
        clickDownload: () => {},
      })
    ).rejects.toThrow('startDate must not be after endDate');
  });

  it('falls back to the status when the error body is not JSON', async () => {
    await expect(
      downloadReport('csv', range, {
        fetchImpl: (async () =>
          new Response('nope', { status: 500 })) as typeof fetch,
        createObjectUrl: () => 'blob:x',
        revokeObjectUrl: () => {},
        clickDownload: () => {},
      })
    ).rejects.toThrow('Report export failed (HTTP 500).');
  });
});
