import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const baseConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
};
const temporaryDirs: string[] = [];

function runsDir(files: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  temporaryDirs.push(dir);
  for (const [night, contents] of Object.entries(files)) {
    writeFileSync(join(dir, `${night}.jsonl`), contents);
  }
  return dir;
}

function run(at: string, job: string, status: 'ok' | 'retry' | 'fail', owner: string | null = null, error?: string) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('digest routes', () => {
  it('serves sorted matching rows as HTML and a raw JSON array', async () => {
    const dir = runsDir({
      '2026-10-28': [
        run('2026-10-28T10:00:00+01:00', 'zeta/job', 'ok', null, 'still reported'),
        run('2026-10-28T10:05:00+01:00', 'alpha/job', 'fail', 'rook', 'disk full'),
        run('2026-10-28T10:06:00+01:00', 'retry/job', 'retry', 'rook'),
        run('2026-10-28T10:07:00+01:00', 'retry/job', 'retry', 'rook'),
        run('2026-10-28T10:08:00+01:00', 'retry/job', 'retry', 'rook'),
        run('2026-10-28T10:09:00+01:00', 'retry/job', 'ok', 'rook'),
      ].join('\n'),
    });
    const app = createApp({ ...baseConfig, runsDir: dir });

    const htmlResponse = await app.request('/digest/2026-10-28');
    const html = await htmlResponse.text();
    const jsonResponse = await app.request('/api/digest/2026-10-28');
    const rows: unknown = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(Array.isArray(rows)).toBe(true);
    if (!Array.isArray(rows)) throw new Error('digest JSON must be an array');
    expect(rows.map((row: { job: string }) => row.job)).toEqual(['alpha/job', 'retry/job', 'zeta/job']);
    expect(html.indexOf('alpha/job')).toBeLessThan(html.indexOf('retry/job'));
    expect(html.indexOf('retry/job')).toBeLessThan(html.indexOf('zeta/job'));
    expect(html).toContain('disk full');
    expect(html).toContain('still reported');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T10:00:00+01:00');
    expect(html).toContain('2026-10-28T10:09:00+01:00');
    expect(html).toMatch(/class="warn"[^>]*>[^<]*fail|<[^>]*class="warn"[^>]*>fail/i);
    expect(html).toMatch(/class="warn"[^>]*>[^<]*3|<[^>]*class="warn"[^>]*>3/i);
    expect(rows).toEqual([
      { job: 'alpha/job', owner: 'rook', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'disk full',
        firstTime: '2026-10-28T10:05:00+01:00', lastTime: '2026-10-28T10:05:00+01:00' },
      { job: 'retry/job', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
        firstTime: '2026-10-28T10:06:00+01:00', lastTime: '2026-10-28T10:09:00+01:00' },
      { job: 'zeta/job', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: 'still reported',
        firstTime: '2026-10-28T10:00:00+01:00', lastTime: '2026-10-28T10:00:00+01:00' },
    ]);
  });

  it('returns 404 for missing and invalid night paths', async () => {
    const app = createApp({ ...baseConfig, runsDir: runsDir() });
    for (const path of ['/digest/2026-10-28', '/digest/not-a-night', '/api/digest/2026-10-28', '/api/digest/not-a-night']) {
      expect((await app.request(path)).status).toBe(404);
    }
  });

  it('renders an empty existing night and returns an empty JSON array', async () => {
    const app = createApp({ ...baseConfig, runsDir: runsDir({ '2026-10-28': '' }) });
    const html = await app.request('/digest/2026-10-28');
    const json = await app.request('/api/digest/2026-10-28');
    expect(html.status).toBe(200);
    expect(await html.text()).toContain('nothing ran');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual([]);
  });

  it('counts malformed lines while rendering and returning valid rows', async () => {
    const dir = runsDir({ '2026-10-28': [
      run('2026-10-28T10:00:00-04:00', 'good/job', 'ok', null),
      '{malformed',
    ].join('\n') });
    const app = createApp({ ...baseConfig, runsDir: dir });
    const htmlResponse = await app.request('/digest/2026-10-28');
    const html = await htmlResponse.text();
    const json = await app.request('/api/digest/2026-10-28');
    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('good/job');
    expect(html).toContain('1 bad line');
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T10:00:00-04:00');
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual([
      { job: 'good/job', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
        firstTime: '2026-10-28T10:00:00-04:00', lastTime: '2026-10-28T10:00:00-04:00' },
    ]);
  });
});
