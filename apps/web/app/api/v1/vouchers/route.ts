// POST /api/v1/vouchers {code, kind, value, expires_at, max_redemptions, min_amount?} → the voucher (mirrored to Arkiv)
// · GET /api/v1/vouchers → the merchant's vouchers, newest first. Dashboard only: the SIWE session cookie (FR-GW-12).
import { handle, ok, sharedRateLimit, readJson, signedInMerchant } from "../../../../lib/server/http.ts";
import { createVoucher, listVouchers, voucherInput, voucherJson } from "../../../../lib/server/vouchers.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const input = voucherInput(await readJson(request));
    // after validation, so bad requests can't use up the merchant's allowance (code review N2); each create is one Arkiv write
    await sharedRateLimit(`vouchers:${merchant.toLowerCase()}`, 30, 60 * 60_000, "closed");
    return ok(voucherJson(await createVoucher(merchant, input)), 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    return ok({ vouchers: (await listVouchers(merchant)).map(voucherJson) });
  });
}
