import express from 'express';
import cors from 'cors';
import { PlaywrightAuditAgent } from './audit/playwright-agent.js';

const app = express();
app.use(cors());

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
    const agent = new PlaywrightAuditAgent(
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
app.listen(PORT, () => {
  console.log(`🎭 Playwright audit server → http://localhost:${PORT}`);
});
