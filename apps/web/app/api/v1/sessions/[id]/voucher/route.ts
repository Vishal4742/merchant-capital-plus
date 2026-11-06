// /api/v1/sessions/:id/voucher: the customer's discount code on a link or page checkout (FR-GW-12, AT-12). POST {code}
// applies it, DELETE removes it, GET reads what is due now (the checkout no longer reads it before paying: the pay route
// answers 409 with the amount due when the sheet's total is stale, batch 021).
// The discount comes off the checkout's ORIGINAL amount (lib/server/vouchers.ts); the pay route charges exactly what it
// claims from the hold. No code changes while a payment is in flight, pending or done (batch-009 security F5).
import { amountDue, applyVoucher } from "../../../../../../lib/server/vouchers.ts";
import type { Checkout } from "../../../../../../lib/server/checkouts.ts";
import { query } from "../../../../../../lib/server/db.ts";
import { HttpError, clientIp, handle, ok, rateLimit, readJson } from "../../../../../../lib/server/http.ts";
import { gatewayCheckout } from "../../../../../../lib/settle.ts";
import { getSession, isInFlight, type Session } from "../../../../../../lib/sessions.ts";
import { plainUsdt } from "../../../../../../lib/usdt.ts";

type Params = { params: Promise<{ id: string }> };
const CHANGES_PER_MINUTE = 10; // per IP and checkout: enough to fix a typo, too few to guess codes
const LINKS_ONLY = "Codes work on payment links and pages.";
const IN_PROGRESS = "Finish or wait for the current payment first.";
const PAID = "This checkout is already paid.";
const EXPIRED = "This checkout has expired. Ask the shop for a new one.";
// vouchers.ts's reasons that are about the checkout, not the code; the rest are already plain and pass through as 400
const REFUSALS: Record<string, [number, string]> = {
  "This checkout is being paid.": [409, IN_PROGRESS],
  "This checkout is already paid.": [410, PAID],
  "This checkout has expired.": [410, EXPIRED],
  "Vouchers work on payment links and pages only.": [404, LINKS_ONLY],
};

async function checkoutFor(params: Params["params"]): Promise<{ id: string; session: Session; checkout: Checkout }> {
  const { id } = await params;
  const session = getSession(id);
  if (!session) throw new HttpError(404, "This checkout doesn't exist.");
  const checkout = await gatewayCheckout(id);
  if (!checkout) throw new HttpError(404, LINKS_ONLY);
  return { id, session, checkout };
}

/** A code may change only on an open checkout: not paid, no payment in flight or pending (F5), not expired (F4). */
function assertChangeable(request: Request, { id, session, checkout }: { id: string; session: Session; checkout: Checkout }): void {
  rateLimit(`voucher:${clientIp(request)}:${id}`, CHANGES_PER_MINUTE, 60_000);
  if (session.payment || checkout.paidAt !== null) throw new HttpError(410, PAID);
  if (isInFlight(id) || session.pending) throw new HttpError(409, IN_PROGRESS);
  if (Date.now() > session.expiresAt) throw new HttpError(410, EXPIRED);
}

const due = (checkout: Checkout, amount: bigint) => ok({ amountDue: plainUsdt(amount), discount: plainUsdt(checkout.usdtAmount - amount), amountUnits: amount.toString() });

export const GET = (_request: Request, { params }: Params) =>
  handle(async () => {
    const { id, checkout } = await checkoutFor(params);
    return due(checkout, (await amountDue(id)) ?? checkout.usdtAmount);
  });

export const POST = (request: Request, { params }: Params) =>
  handle(async () => {
    const found = await checkoutFor(params);
    assertChangeable(request, found);
    const body = await readJson(request, 1_024);
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) throw new HttpError(400, "Enter a code.");
    const result = await applyVoucher(found.checkout.merchant, code, found.id, found.checkout.usdtAmount);
    if (!result.ok) {
      const [status, message]: [number, string] = REFUSALS[result.reason] ?? [400, result.reason];
      throw new HttpError(status, message);
    }
    return due(found.checkout, result.usdtAmount);
  });

export const DELETE = (request: Request, { params }: Params) =>
  handle(async () => {
    const found = await checkoutFor(params);
    assertChangeable(request, found);
    // ponytail: vouchers.ts has no remove yet; this deletes only a live hold (never one being paid or confirmed), so it
    // can only free a use. Move it next to applyVoucher when claude-contracts adds one.
    await query("DELETE FROM app_gw_redemptions WHERE session_id = $1 AND confirmed_at IS NULL AND frozen_at IS NULL", [found.id]);
    return due(found.checkout, (await amountDue(found.id)) ?? found.checkout.usdtAmount);
  });
