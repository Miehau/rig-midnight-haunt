import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
let runsDir: string;

beforeEach(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  vi.stubEnv('LANE_ID', 'digest-test-lane');
  vi.stubEnv('LANE_MARKER', 'digest-test-marker');
});

afterEach(() => {
  try {
    rmSync(runsDir, { recursive: true, force: true });
  } finally {
    vi.unstubAllEnvs();
  }
});

function fixture(text?: string) {
  if (text !== undefined) { writeFileSync(join(runsDir, `${night}.jsonl`), text); }
  return createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60, runsDir });
}

function tableRows(html: string) {
  const table = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/)?.[1] ?? '';
  return Array.from(table.matchAll(/<tr\b[^>]*\bdata-job="([^"]+)"[^>]*>[\s\S]*?<\/tr>/g),
    match => ({ job: match[1], html: match[0] }));
}

const warning = /\bclass="[^"]*\bwarn\b[^"]*"/;

describe('digest routes', () => {
  it('serves the same sorted jobs and values in HTML and JSON, marking retries and failures', async () => {
    const records = [
      { job: 'notes/backup', owner: 'rook', status: 'fail',
        at: '2026-10-29T02:00:00+01:00', error: 'quota exceeded' },
      { job: 'fixtures/refresh', owner: 'rook', status: 'retry',
        at: '2026-10-29T01:30:00+01:00', error: 'upstream 503' },
      { job: 'fixtures/refresh', owner: 'rook', status: 'retry',
        at: '2026-10-29T01:32:00+01:00', error: 'upstream 503' },
      { job: 'fixtures/refresh', owner: 'rook', status: 'retry',
        at: '2026-10-29T01:35:00+01:00', error: 'upstream 503' },
      { job: 'fixtures/refresh', owner: 'rook', status: 'ok',
        at: '2026-10-29T01:37:00+01:00' },
      { job: 'digest/render', owner: null, status: 'ok',
        at: '2026-10-29T05:41:09+01:00' },
    ];
    const expected: NightDigest = {
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok',
          lastError: 'upstream 503', firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'notes/backup', owner: 'rook', runs: 1, retries: 0, lastStatus: 'fail',
          lastError: 'quota exceeded', firstAt: '2026-10-29T02:00:00+01:00', lastAt: '2026-10-29T02:00:00+01:00' },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 3, fail: 1 },
    };
    const app = fixture(records.map(record => JSON.stringify(record)).join('\n') + '\n');
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');
    const digest: NightDigest = await json.json();
    expect(digest).toEqual(expected);

    const rows = tableRows(await page.text());
    expect(rows.map(row => row.job)).toEqual(digest.rows.map(row => row.job));
    for (const [index, row] of expected.rows.entries()) {
      const html = rows[index].html;
      const values = [row.job, row.owner ?? '—', row.runs, row.retries,
        row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt];
      const cells = Array.from(html.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/g), match => match[1]);
      expect(cells).toEqual(values.map(String));
      if (row.retries >= 3 || row.lastStatus === 'fail') {
        expect(html).toMatch(warning);
      } else {
        expect(html).not.toMatch(warning);
      }
    }
  });

  it('returns 404 on both surfaces when the night has no file', async () => {
    const app = fixture();
    for (const path of [`/digest/${night}`, `/api/digest/${night}`]) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('renders an empty night as nothing ran and returns an empty digest', async () => {
    const app = fixture('');
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toMatch(/nothing ran/i);
    expect(tableRows(html)).toEqual([]);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed lines while preserving valid jobs before and after them', async () => {
    const first = { at: '2026-10-29T01:00:00+01:00', job: 'a/before', owner: null, status: 'ok' };
    const last = { at: '2026-10-29T02:00:00+01:00', job: 'z/after', owner: 'rook', status: 'fail', error: 'disk full' };
    const app = fixture(`${JSON.stringify(first)}\nnot json\n{}\n${JSON.stringify(last)}\n`);
    const page = await app.request(`/digest/${night}`);
    const json = await app.request(`/api/digest/${night}`);
    expect(page.status).toBe(200);
    expect(json.status).toBe(200);
    const digest: NightDigest = await json.json();
    expect(digest).toEqual({
      rows: [
        { job: 'a/before', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: first.at, lastAt: first.at },
        { job: 'z/after', owner: 'rook', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'disk full',
          firstAt: last.at, lastAt: last.at },
      ],
      badLines: 2,
      counts: { ok: 1, retry: 0, fail: 1 },
    });
    const html = await page.text();
    expect(tableRows(html).map(row => row.job)).toEqual(digest.rows.map(row => row.job));
    expect(html).toMatch(/(?:malformed|bad)[^<]*\b2\b/i);
    expect(tableRows(html)[1].html).toContain('disk full');
  });
});
