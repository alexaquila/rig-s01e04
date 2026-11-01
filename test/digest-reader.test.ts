import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const temporaryDirs: string[] = [];
function fixture(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  temporaryDirs.push(dir);
  writeFileSync(join(dir, '2026-10-28.jsonl'), contents);
  return dir;
}
afterEach(() => { for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true }); });

describe('readNight', () => {
  it('reads the real night without losing null owners, errors or offsets', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night.exists).toBe(true);
    expect(night.badLines).toBe(1);
    expect(night.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(night.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(night.rows[0].owner).toBeNull();
    expect(night.rows[1]).toEqual({ job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
      lastStatus: 'ok', lastError: 'upstream 503', firstTime: '2026-10-29T01:30:00+01:00',
      lastTime: '2026-10-29T01:37:00+01:00' });
    expect(night.rows[3].lastStatus).toBe('fail');
  });

  it('distinguishes a missing night from an empty file and rejects path traversal', () => {
    const dir = fixture('');
    expect(readNight(dir, '2026-10-28')).toEqual({ exists: true, rows: [], badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 } });
    expect(readNight(dir, '2026-10-29').exists).toBe(false);
    expect(readNight(dir, '../2026-10-28').exists).toBe(false);
    writeFileSync(join(dir, '2026-02-30.jsonl'), '');
    expect(readNight(dir, '2026-02-30').exists).toBe(false);
  });

  it('counts malformed JSON and invalid records while continuing through CRLF logs', () => {
    const valid = { at: '2026-10-28T10:00:00+01:00', job: 'job', owner: null, status: 'ok' };
    const dir = fixture(['broken', 'null', '{}', JSON.stringify({ ...valid, status: 'other' }),
      JSON.stringify({ ...valid, at: 'yesterday' }), '', JSON.stringify(valid), ''].join('\r\n'));
    const night = readNight(dir, '2026-10-28');
    expect(night.badLines).toBe(6);
    expect(night.rows).toHaveLength(1);
    expect(night.rows[0].runs).toBe(1);
  });

  it('uses event chronology across offsets and preserves the latest reported error', () => {
    const dir = fixture([
      { at: '2026-10-28T10:00:00+01:00', job: 'job', owner: null, status: 'ok' },
      { at: '2026-10-28T09:30:00+02:00', job: 'job', owner: 'old', status: 'retry', error: 'newer error' },
      { at: '2026-10-28T08:00:00+02:00', job: 'job', owner: 'old', status: 'fail', error: 'older error' },
    ].map(run => JSON.stringify(run)).join('\n'));
    expect(readNight(dir, '2026-10-28').rows[0]).toEqual({ job: 'job', owner: null,
      runs: 3, retries: 1, lastStatus: 'ok', lastError: 'newer error',
      firstTime: '2026-10-28T08:00:00+02:00', lastTime: '2026-10-28T10:00:00+01:00' });
  });
});
