import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, NightDigest, ReadNight } from './types.js';

type Run = { at: string; job: string; status: DigestStatus; owner: string | null; error?: string };

function isRun(value: unknown): value is Run {
  if (typeof value !== 'object' || value === null) return false;
  const run = value as Record<string, unknown>;
  return typeof run.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(run.at)
    && Number.isFinite(Date.parse(run.at))
    && typeof run.job === 'string' && run.job.length > 0
    && (run.status === 'ok' || run.status === 'retry' || run.status === 'fail')
    && (typeof run.owner === 'string' || run.owner === null)
    && (run.error === undefined || typeof run.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  const result: NightDigest = { exists: false, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } };
  // Route parameters must never escape the runs directory.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return result;
  const date = new Date(`${night}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== night) return result;
  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return result;
    throw error;
  }
  result.exists = true;
  const jobs = new Map<string, { row: DigestRow; errorTime: number }>();
  const lines = contents.split(/\r?\n/);
  // A final newline terminates the last record; it is not another bad record.
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    let run: unknown;
    try { run = JSON.parse(line); } catch { result.badLines++; continue; }
    if (!isRun(run)) { result.badLines++; continue; }
    result.counts[run.status]++;
    const time = Date.parse(run.at);
    let entry = jobs.get(run.job);
    if (!entry) {
      entry = {
        row: { job: run.job, owner: run.owner, runs: 0, retries: 0, lastStatus: run.status,
          lastError: null, firstTime: run.at, lastTime: run.at },
        errorTime: -Infinity,
      };
      jobs.set(run.job, entry);
    }
    const { row } = entry;
    row.runs++;
    if (run.status === 'retry') row.retries++;
    if (time < Date.parse(row.firstTime)) row.firstTime = run.at;
    if (time >= Date.parse(row.lastTime)) {
      row.lastTime = run.at;
      row.lastStatus = run.status;
      row.owner = run.owner;
    }
    if (run.error !== undefined && time >= entry.errorTime) {
      row.lastError = run.error;
      entry.errorTime = time;
    }
  }
  result.rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return result;
};
