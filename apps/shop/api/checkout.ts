// POST /api/checkout: create a gateway checkout for one espresso and send the customer to it (AT-14, FR-GW-5).
import { Gateway } from '../lib/sdk.ts';

const ESPRESSO = { name: 'Espresso', qty: 1, price: '2.00' };

export async function POST(request: Request): Promise<Response> {
  // A missing GATEWAY_SECRET_KEY / GATEWAY_URL throws here: a config mistake, so a 500.
  const gateway = new Gateway(process.env.GATEWAY_SECRET_KEY ?? '', { baseUrl: process.env.GATEWAY_URL ?? '' });
  const session = await gateway.sessions
    .create({ amount: ESPRESSO.price, items: [ESPRESSO], orderId: `espresso-${Date.now()}`, returnUrl: new URL('/', request.url).href })
    .catch((err: Error) => console.error('checkout failed:', err.message)); // the SDK replaces the key with [secret key]
  return session ? Response.redirect(session.url, 303) : new Response('The checkout is unavailable right now. Please try again in a minute.', { status: 502 });
}
