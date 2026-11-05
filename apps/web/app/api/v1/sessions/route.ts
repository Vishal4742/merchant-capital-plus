// POST /api/v1/sessions: a shop creates a checkout with its secret key and gets a hosted pay URL (FR-PAY-4).
import { merchantConfig, shopAuthorized } from "../../../../lib/config.ts";
import { createSession, type LineItem } from "../../../../lib/sessions.ts";
import { formatUsdt, parseUsdt } from "../../../../lib/usdt.ts";

const MIN_UNITS = 1_000_000n; // 1 USDT minimum payment (FR-REL-4)
const MAX_UNITS = 10_000_000_000n; // 10,000 USDT: a demo ceiling, well above every demo amount
const MAX_ITEMS = 20;

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const config = merchantConfig();
  if (!config) return fail(503, "Checkout isn't set up on this server.");
  if (!shopAuthorized(request, config.apiKey)) return fail(401, "Missing or wrong API key.");

  const body = (await request.json().catch(() => null)) as { amount?: unknown; reference?: unknown; items?: unknown } | null;
  if (!body || typeof body.amount !== "string") return fail(400, 'Send JSON like {"amount": "25.00"}.');
  let amount: bigint;
  try {
    amount = parseUsdt(body.amount);
  } catch {
    return fail(400, "amount must look like 25.00 (up to 6 decimals).");
  }
  if (amount < MIN_UNITS || amount > MAX_UNITS) return fail(400, "amount must be between 1.00 and 10,000.00 USDT.");

  const reference = typeof body.reference === "string" ? body.reference.trim().slice(0, 40) : "";
  const items: LineItem[] = [];
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || body.items.length > MAX_ITEMS) return fail(400, `items must be a list of at most ${MAX_ITEMS}.`);
    for (const raw of body.items as { name?: unknown; qty?: unknown; price?: unknown }[]) {
      const qty = Number(raw?.qty);
      if (typeof raw?.name !== "string" || !raw.name.trim() || !Number.isInteger(qty) || qty < 1 || qty > 999 || typeof raw.price !== "string") {
        return fail(400, 'Each item needs {"name", "qty" (1-999), "price" like "10.00"}.');
      }
      try {
        items.push({ name: raw.name.trim().slice(0, 80), qty, price: parseUsdt(raw.price) });
      } catch {
        return fail(400, `Item "${raw.name.trim().slice(0, 40)}" has a bad price.`);
      }
    }
    const total = items.reduce((sum, item) => sum + item.price * BigInt(item.qty), 0n);
    if (items.length && total !== amount) return fail(400, `Items add up to ${formatUsdt(total)}, but amount is ${formatUsdt(amount)}.`);
  }

  const session = createSession({ merchant: config.merchant, merchantName: config.merchantName, amount, reference, items });
  const url = new URL(`/checkout/${session.id}`, request.url).toString();
  return Response.json({ id: session.id, url, amount: formatUsdt(amount), expiresAt: new Date(session.expiresAt).toISOString() }, { status: 201 });
}
