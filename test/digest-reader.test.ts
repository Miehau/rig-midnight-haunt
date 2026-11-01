import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) { rmSync(dir, { recursive: true }); } });
function fixture(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  dirs.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), text);
  return dir;
}

describe('night reader', () => {
  it('aggregates the supplied night without losing retries, errors, or missing owners', () => {
    const digest = readNight('runs', '2026-10-28');
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toEqual({ job: 'digest/render', owner: null, runs: 1,
      retries: 0, lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' });
    expect(digest?.rows[1]).toEqual({ job: 'fixtures/refresh', owner: 'rook', runs: 4,
      retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' });
    expect(digest?.rows[3].lastStatus).toBe('fail');
    expect(digest?.rows[3].lastError).toBe('quota exceeded');
  });

  it('distinguishes missing and empty files and rejects path traversal', () => {
    const dir = fixture('');
    expect(readNight(dir, '2026-10-29')).toBeNull();
    expect(readNight(dir, '../2026-10-28')).toBeNull();
    expect(readNight(dir, '2026-10-28')).toEqual({ rows: [], badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it('counts malformed records while keeping valid records on either side', () => {
    const valid = JSON.stringify({ at: '2026-10-28T01:00:00+01:00', job: 'a', owner: null, status: 'ok' });
    const dir = fixture(`${valid}\nnot json\nnull\n{}\n\n${valid}\n`);
    const digest = readNight(dir, '2026-10-28');
    expect(digest?.badLines).toBe(4);
    expect(digest?.rows[0].runs).toBe(2);
    expect(digest?.counts.ok).toBe(2);
  });

  it('uses event time across offsets, preserving original timestamps and latest error', () => {
    const runs = [
      { at: '2026-10-28T02:00:00+01:00', status: 'ok', owner: null },
      { at: '2026-10-28T01:30:00+01:00', status: 'retry', error: 'newer error', owner: 'rook' },
      { at: '2026-10-28T02:00:00+02:00', status: 'fail', error: 'older error', owner: 'rook' },
    ].map(run => JSON.stringify({ job: 'a', ...run })).join('\n');
    const row = readNight(fixture(runs), '2026-10-28')?.rows[0];
    expect(row).toEqual({ job: 'a', owner: null, runs: 3, retries: 1,
      lastStatus: 'ok', lastError: 'newer error',
      firstAt: '2026-10-28T02:00:00+02:00', lastAt: '2026-10-28T02:00:00+01:00' });
  });
});
