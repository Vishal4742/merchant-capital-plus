// POST /api/webhook: the gateway's signed payment events (AT-14, FR-GW-7). The raw body is what was signed.
import { SIGNATURE_HEADER, WebhookSignatureError, constructEvent } from '../lib/sdk.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    const event = constructEvent(await request.text(), request.headers.get(SIGNATURE_HEADER), process.env.GATEWAY_WEBHOOK_SECRET ?? '');
    // ponytail: no order database, so this log line is the shop's record. A real shop matches data.id to its stored
    // session, checks sameAmount and dedupes on event.id (packages/sdk/README.md step 2).
    console.info(`verified ${event.type} ${event.id} session=${event.data.id} status=${event.data.status} amount=${event.data.amount}`);
    return new Response('ok');
  } catch (err) {
    if (err instanceof WebhookSignatureError) return new Response('bad signature', { status: 400 });
    throw err; // no secret configured: a 500, so the gateway retries once it's set
  }
}
