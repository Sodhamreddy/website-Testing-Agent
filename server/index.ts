import express from 'express';
import cors from 'cors';
import { TestCaseAuditAgent } from './audit/testcase-agent.js';

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

  try {
    const agent = new TestCaseAuditAgent(
      url,
      (msg, type = 'info') => send({ type: 'log', msg, logType: type }),
      (pct) => send({ type: 'progress', pct }),
    );
    const result = await agent.runFullAudit();
    send({ type: 'complete', ...result });
  } catch (err) {
    send({ type: 'error', msg: String(err) });
  } finally {
    res.end();
  }
});

const PORT = Number(process.env.PORT ?? 3001);
const server = app.listen(PORT, () => {
  console.log(`🧪 QA audit server (deterministic Playwright engine — no LLM) → http://localhost:${PORT}`);
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
