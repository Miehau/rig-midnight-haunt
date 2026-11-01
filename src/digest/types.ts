export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
  counts: Record<RunStatus, number>;
};

// Rows are sorted by job. Times retain their original offsets. A missing file
// returns null; an empty file returns an empty digest. Other I/O errors propagate.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
