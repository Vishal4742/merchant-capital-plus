// Local dev server, bound to 127.0.0.1 only: serves the Vercel handlers at POST /relay and GET /health.
// ponytail: dev-only adapter; on Vercel the api/ files are the functions (rewrites added with the deploy batch).
import { createServer } from 'node:http';
import { GET as health } from './api/health.ts';
import { POST as relay } from './api/relay.ts';

const PORT = Number(process.env.PORT ?? 8787);
const routes: Record<string, (request: Request) => Promise<Response>> = {
  'POST /relay': relay,
  'GET /health': health,
};

createServer(async (req, res) => {
  const handler = routes[`${req.method} ${(req.url ?? '/').split('?')[0]}`];
  if (!handler) return void res.writeHead(404).end();
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handler(new Request(`http://127.0.0.1${req.url}`, {
      method: req.method,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    }));
    res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'text/plain' });
    res.end(await response.text());
  } catch (e) {
    process.stderr.write(`handler failed: ${e instanceof Error ? e.message : 'unknown'}\n`);
    res.writeHead(500).end('internal error');
  }
}).listen(PORT, '127.0.0.1', () => process.stdout.write(`relayer dev server on http://127.0.0.1:${PORT}\n`));
