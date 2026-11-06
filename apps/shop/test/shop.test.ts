// AT-14: the demo shop's two gateway touch points, the checkout (SDK sessions.create) and the signed webhook.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POST as checkout } from '../api/checkout.ts';
import { POST as webhook } from '../api/webhook.ts';
import { SIGNATURE_HEADER, signWebhook } from '../lib/sdk.ts';

const SECRET = 'whsec_test_only';
process.env.GATEWAY_WEBHOOK_SECRET = SECRET;
process.env.GATEWAY_SECRET_KEY = 'sk_test_only';
process.env.GATEWAY_URL = 'http://127.0.0.1:3100';

const event = JSON.stringify({ id: 'evt_1', type: 'payment.succeeded', created: 1, data: { id: 'cs_1', status: 'paid', amount: '2.00' } });
const hook = (body: string, header?: string) =>
  webhook(new Request('https://shop.test/api/webhook', { method: 'POST', body, headers: header ? { [SIGNATURE_HEADER]: header } : {} }));

test('webhook: an event signed with the endpoint secret is accepted (200)', async () => {
  assert.equal((await hook(event, signWebhook(event, SECRET))).status, 200);
});

test('webhook: a wrong secret, a changed body or no signature is refused (400)', async () => {
  assert.equal((await hook(event, signWebhook(event, 'whsec_other'))).status, 400);
  assert.equal((await hook(event.replace('2.00', '9.00'), signWebhook(event, SECRET))).status, 400);
  assert.equal((await hook(event)).status, 400);
});

test('checkout: creates a 2.00 USDT session with the secret key and sends the customer there (303)', async (t) => {
  const calls: { url: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ id: 'cs_9', url: 'http://127.0.0.1:3100/checkout/cs_9', amount: '2.00', currency: 'USDT', expiresAt: '' }, { status: 201 });
  });
  const res = await checkout(new Request('http://127.0.0.1:4100/api/checkout', { method: 'POST' }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), 'http://127.0.0.1:3100/checkout/cs_9');
  assert.equal(calls[0].url, 'http://127.0.0.1:3100/api/v1/sessions');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer sk_test_only');
  const sent = JSON.parse(String(calls[0].init.body));
  assert.equal(sent.amount, '2.00');
  assert.equal(sent.returnUrl, 'http://127.0.0.1:4100/');
  assert.match(sent.reference, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'a unique order reference per checkout');
});

test('checkout: a gateway failure shows the customer a 502, never the error text', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'nope' }, { status: 401 }));
  const res = await checkout(new Request('http://127.0.0.1:4100/api/checkout', { method: 'POST' }));
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /nope|sk_/);
});
