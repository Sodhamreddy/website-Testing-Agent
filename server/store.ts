import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { TestIssue, TestResult, ChecklistStatus } from '../src/types/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'data', 'audits');

/** Folder-safe key for a client — the site's host. */
export function clientKey(url: string): string {
  try { return new URL(url.startsWith('http') ? url : 'https://' + url).host.toLowerCase().replace(/[^a-z0-9.-]/g, '_'); }
  catch { return url.toLowerCase().replace(/[^a-z0-9.-]/g, '_') || 'unknown'; }
}

/**
 * Stable identity for one bug across audit runs: category + normalised name +
 * the page's path (minus viewport / section suffixes). Lets us tell "same bug"
 * from "different bug" when re-auditing after fixes.
 */
export function fingerprint(i: Pick<TestIssue, 'category' | 'name' | 'affectedPage'>): string {
  const page = (i.affectedPage || '').split(' @ ')[0].split(' › ')[0].trim();
  let path = page;
  try { path = new URL(page.startsWith('http') ? page : 'https://' + page).pathname.replace(/\/$/, '') || '/'; } catch { /* */ }
  const name = i.name.toLowerCase()
    .replace(/\b\d+\b/g, '#')                    // "3 broken images" ~ "5 broken images"
    .replace(/["'`“”]/g, '').replace(/\s+/g, ' ').trim();
  return createHash('sha1').update(`${(i.category || '').toLowerCase()}|${name}|${path}`).digest('hex').slice(0, 12);
}

export interface IssueDelta {
  fp: string;
  name: string;
  category: string;
  severity: string;
  affectedPage: string;
}

export interface RunComparison {
  previousRunId: string | null;
  previousRanAt: string | null;
  summary: { total: number; newCount: number; recurringCount: number; resolvedCount: number };
  resolved: IssueDelta[];          // in the previous run, gone now → fixed
  recurring: string[];             // fingerprints present in both runs (still open)
  newFps: string[];                // fingerprints new this run
}

export interface StoredRun {
  id: string;                      // ISO-ish, sortable
  client: string;
  url: string;
  ranAt: string;
  score: number | null;
  counts: { total: number; critical: number; major: number; minor: number };
  issues: (TestIssue & { fp: string })[];
  checklistStatus: ChecklistStatus;
  result: TestResult | null;
  comparison: RunComparison;
}

function ensure(dir: string) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

/** Newest-first list of run summaries for a client. */
export function listRuns(client: string): { id: string; ranAt: string; score: number | null; counts: StoredRun['counts']; comparison: RunComparison['summary'] }[] {
  const dir = join(ROOT, client);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredRun;
      return { id: r.id, ranAt: r.ranAt, score: r.score, counts: r.counts, comparison: r.comparison.summary };
    } catch { return null; }
  }).filter(Boolean) as never;
}

export function getRun(client: string, id: string): StoredRun | null {
  const p = join(ROOT, client, `${id}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as StoredRun; } catch { return null; }
}

export function latestRun(client: string): StoredRun | null {
  const dir = join(ROOT, client);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) return null;
  return getRun(client, files[files.length - 1].replace(/\.json$/, ''));
}

/**
 * Persist a finished audit for its client. Each issue is stored with a stable
 * `fp` only — no per-issue state tag. The run-level `comparison` still reports
 * which fingerprints are new / recurring / resolved vs the previous run.
 */
export function saveRun(url: string, issues: TestIssue[], checklistStatus: ChecklistStatus, result: TestResult | null): { run: StoredRun; comparison: RunComparison } {
  const client = clientKey(url);
  const prev = latestRun(client);
  const prevByFp = new Map((prev?.issues ?? []).map((i) => [i.fp, i]));

  const tagged = issues.map((i) => ({ ...i, fp: fingerprint(i) }));
  const nowFps = new Set(tagged.map((i) => i.fp));

  const resolved: IssueDelta[] = (prev?.issues ?? [])
    .filter((i) => !nowFps.has(i.fp))
    .map((i) => ({ fp: i.fp, name: i.name, category: i.category, severity: i.severity, affectedPage: i.affectedPage }));
  const recurring = tagged.filter((i) => prevByFp.has(i.fp)).map((i) => i.fp);
  const newFps = tagged.filter((i) => !prevByFp.has(i.fp)).map((i) => i.fp);

  const comparison: RunComparison = {
    previousRunId: prev?.id ?? null,
    previousRanAt: prev?.ranAt ?? null,
    summary: { total: tagged.length, newCount: newFps.length, recurringCount: recurring.length, resolvedCount: resolved.length },
    resolved, recurring, newFps,
  };

  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const run: StoredRun = {
    id, client, url, ranAt: new Date().toISOString(),
    score: result?.testingScore ?? null,
    counts: {
      total: tagged.length,
      critical: tagged.filter((i) => i.severity === 'Critical').length,
      major: tagged.filter((i) => i.severity === 'Major').length,
      minor: tagged.filter((i) => i.severity === 'Minor').length,
    },
    issues: tagged, checklistStatus, result, comparison,
  };

  const dir = join(ROOT, client);
  ensure(dir);
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(run));
  return { run, comparison };
}
