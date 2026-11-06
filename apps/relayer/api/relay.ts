import { createHash, timingSafeEqual } from 'node:crypto';
import { health, relay, relayerClient } from '../src/relayer.ts';

// Only our web server holds RELAY_API_SECRET (human 02:44, ARCHITECTURE §3 point 13). Digests make the compare
// constant-time and equal-length; an unset secret refuses every request.
const digest = (s: string) => createHash('sha256').update(s).digest();
function authorized(request: Request): boolean {
  const secret = process.env.RELAY_API_SECRET;
  if (!secret) return false;
  return timingSafeEqual(digest(request.headers.get('x-relay-secret') ?? ''), digest(secret));
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: 'missing or wrong x-relay-secret', code: 'unauthorized' }, { status: 401 });
  // JSON only: a cross-site form can't send it without a CORS preflight, which this API never answers.
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    return Response.json({ error: 'content-type must be application/json', code: 'unsupported_media_type' }, { status: 415 });
  }
  return relay(await request.text(), relayerClient());
}

// GET /health lives in this function too, so a /health warm-up ping warms the instance and RPC socket a sale uses.
export function GET(): Promise<Response> {
  return health(relayerClient());
}
