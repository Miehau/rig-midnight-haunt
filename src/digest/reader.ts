import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

type Run = { at: string; job: string; owner: string | null; status: RunStatus; error?: string };

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) { return false; }
  const run = value as Record<string, unknown>;
  return typeof run.at === 'string' && Number.isFinite(Date.parse(run.at))
    && typeof run.job === 'string' && run.job.length > 0
    && (run.owner === null || typeof run.owner === 'string')
    && (run.status === 'ok' || run.status === 'retry' || run.status === 'fail')
    && (run.error === undefined || typeof run.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) { return null; }
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') { return null; }
    throw error;
  }
  const digest: NightDigest = { rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  const jobs = new Map<string, { row: DigestRow; errorAt: number }>();
  const lines = text.split('\n');
  // A terminal newline ends the last record; it is not another malformed record.
  if (lines[lines.length - 1] === '') { lines.pop(); }
  for (const line of lines) {
    let run: unknown;
    try { run = JSON.parse(line); } catch { digest.badLines++; continue; }
    if (!isRun(run)) { digest.badLines++; continue; }
    digest.counts[run.status]++;
    const at = Date.parse(run.at);
    let entry = jobs.get(run.job);
    if (!entry) {
      entry = { row: { job: run.job, owner: run.owner, runs: 0, retries: 0,
        lastStatus: run.status, lastError: null, firstAt: run.at, lastAt: run.at }, errorAt: -Infinity };
      jobs.set(run.job, entry);
    }
    const row = entry.row;
    row.runs++;
    if (run.status === 'retry') { row.retries++; }
    if (at < Date.parse(row.firstAt)) { row.firstAt = run.at; }
    if (at >= Date.parse(row.lastAt)) {
      row.lastAt = run.at;
      row.lastStatus = run.status;
      row.owner = run.owner;
    }
    if (run.error !== undefined && at >= entry.errorAt) {
      row.lastError = run.error;
      entry.errorAt = at;
    }
  }
  digest.rows = Array.from(jobs.values(), ({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return digest;
};
