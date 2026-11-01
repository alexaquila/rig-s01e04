export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  // Most recent error reported, even if a later run succeeded.
  lastError: string | null;
  // Original log strings, including their timezone offsets.
  firstTime: string;
  lastTime: string;
};

export type NightDigest = {
  exists: boolean;
  rows: DigestRow[];
  badLines: number;
  // Counts of valid log records, rather than final job statuses.
  counts: Record<DigestStatus, number>;
};

// Implemented and exported by ./reader.ts. Synchronous, matching readStatus.
export type ReadNight = (runsDir: string, night: string) => NightDigest;
