import express from 'express';
import cors from 'cors';
import { runExplorerAudit } from './agent/explorer.js';
import { clientKey, getRun, listRuns, saveRun } from './store.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/audit/stream', async (req, res) => {
  const url = req.query.url as string;

  if (!url) {
    res.status(400).json({ error: 'url parameter required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });

  const send = (data: object) => {
    if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const log = (msg: string, type = 'info') => send({ type: 'log', msg, logType: type });
  const progress = (pct: number) => send({ type: 'progress', pct });

  try {
    // Single engine: the exploration agent. The LLM roams the site with browser
    // tools, deep-analyses each page (issues + GEO/AI-search recs), runs a
    // security scan, and decides what to check — no fixed phases.
    const result = await runExplorerAudit(url, log, progress);

    // Persist this run for the client and diff it against the previous one.
    let comparison = undefined;
    let runId = undefined;
    try {
      const saved = saveRun(url, result.issues, result.checklistStatus, result.result);
      comparison = saved.comparison;
      runId = saved.run.id;
      result.issues = saved.run.issues; // now carry a stable { fp }
      const c = comparison.summary;
      if (comparison.previousRanAt) {
        log(`📊 vs previous audit (${new Date(comparison.previousRanAt).toLocaleString()}): ${c.resolvedCount} fixed, ${c.recurringCount} still open, ${c.newCount} new.`,
          c.resolvedCount ? 'success' : 'info');
      } else {
        log('📊 First audit for this client — saved as the baseline.', 'info');
      }
    } catch (e) {
      log(`⚠️ Could not save audit history: ${e instanceof Error ? e.message : e}`, 'warning');
    }

    send({ type: 'complete', ...result, comparison, runId });
  } catch (err) {
    send({ type: 'error', msg: String(err) });
  } finally {
    res.end();
  }
});

// ── Audit history per client ────────────────────────────────────────────────
app.get('/api/audits/history', (req, res) => {
  const url = (req.query.url ?? req.query.host) as string;
  if (!url) { res.status(400).json({ error: 'url or host required' }); return; }
  res.json({ client: clientKey(url), runs: listRuns(clientKey(url)) });
});

app.get('/api/audits/run', (req, res) => {
  const url = (req.query.url ?? req.query.host) as string;
  const id = req.query.id as string;
  if (!url || !id) { res.status(400).json({ error: 'url/host and id required' }); return; }
  const run = getRun(clientKey(url), id);
  if (!run) { res.status(404).json({ error: 'run not found' }); return; }
  res.json(run);
});

const PORT = Number(process.env.PORT ?? 3001);
const server = app.listen(PORT, () => {
  console.log(`🧪 QA exploration-agent server → http://localhost:${PORT}  (needs AI_API_KEY — see .env.example)`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use — an OLD audit server is still running.`);
    console.error(`   This server did NOT start; the stale one keeps serving old code.`);
    console.error(`   Kill it:  Get-NetTCPConnection -LocalPort ${PORT} | %{ Stop-Process -Id $_.OwningProcess -Force }\n`);
  } else {
    console.error('[audit-server] listen error:', err.message);
  }
});
