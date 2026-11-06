// POST /api/v1/quotes {amount, currency}: a USDT price for a fiat amount, locked 10 minutes (SRS FR-GW-11).
// Public (the hosted checkout calls it), so it is rate-limited per IP.
import { clientIp, currencyField, handle, ok, rateLimit, readJson, textField } from "../../../../lib/server/http.ts";
import { createQuote, quoteJson } from "../../../../lib/server/quotes.ts";

export async function POST(request: Request) {
  return handle(async () => {
    rateLimit(`quotes:${clientIp(request)}`, 30, 60_000);
    const body = await readJson(request);
    const quote = await createQuote(textField(body.amount, "amount", { max: 20 }), currencyField(body.currency));
    return ok(quoteJson(quote), 201);
  });
}
