// POST /api/webhook: the gateway's signed payment events (AT-14, FR-GW-7). The raw body is what was signed.
import { SIGNATURE_HEADER, WebhookSignatureError, constructEvent } from '../lib/sdk.ts';

export async function POST(request: Request): Promise<Response> {
  try {
    // the exact bytes that were signed (request.text() would drop a BOM and rewrite invalid UTF-8)
    const event = constructEvent(new Uint8Array(await request.arrayBuffer()), request.headers.get(SIGNATURE_HEADER), process.env.GATEWAY_WEBHOOK_SECRET ?? '');
    // ponytail: no order database, so this log line is the shop's record. A real shop fulfils only when type is
    // payment.succeeded, data.status is "paid" and data.test is absent (the dashboard's test send uses the same type),
    // matches data.id to its stored session, checks sameAmount and dedupes on event.id: retries reuse the id with a
    // fresh signature (packages/sdk/README.md step 2).
    console.info(`verified ${event.type} ${event.id} session=${event.data.id} status=${event.data.status} amount=${event.data.amount}`);
    return new Response('ok');
  } catch (err) {
    if (err instanceof WebhookSignatureError) return new Response('bad signature', { status: 400 });
    throw err; // no secret configured: a 500, so the gateway retries once it's set
  }
}
