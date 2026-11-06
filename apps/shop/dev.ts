// Local shop on 127.0.0.1:4100 with the same handlers Vercel runs: npm run dev (.env: GATEWAY_URL, GATEWAY_SECRET_KEY).
// It exists because the gateway runs on 127.0.0.1:3100 today, which only a local process can reach.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { POST as checkout } from './api/checkout.ts';
import { POST as webhook } from './api/webhook.ts';

const PORT = 4100;
const page = readFileSync(new URL('./public/index.html', import.meta.url));
const routes: Record<string, (request: Request) => Promise<Response>> = { '/api/checkout': checkout, '/api/webhook': webhook };

// ponytail: loopback only, no body cap or Host check; the public copy is the Vercel deploy.
createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  try {
    const route = req.method === 'POST' ? routes[path] : undefined;
    if (!route) {
      res.writeHead(path === '/' ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }).end(path === '/' ? page : 'not found');
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const signature = req.headers['mc-signature'];
    const headers = typeof signature === 'string' ? { 'mc-signature': signature } : undefined;
    const response = await route(new Request(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers, body: Buffer.concat(chunks) }));
    res.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('handler failed:', (err as Error).message);
    if (!res.headersSent) res.writeHead(500).end('error');
  }
}).listen(PORT, '127.0.0.1', () => console.info(`shop on http://127.0.0.1:${PORT}`));
