// POST /api/v1/vouchers {code, kind, value, expires_at, max_redemptions, min_amount?} → the voucher (mirrored to Arkiv)
// · GET /api/v1/vouchers → the merchant's vouchers, newest first (FR-GW-12). Batch 051 R2-1: creating needs
// invoices:draft (Owner, Operator), listing invoices:read (any member).
import { handle, ok, sharedRateLimit, readJson } from "../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../lib/server/legacy.ts";
import { createVoucher, listVouchers, voucherInput, voucherJson } from "../../../../lib/server/vouchers.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const access = await legacyAccess(request, "invoices:draft");
    const input = voucherInput(await readJson(request));
    // after validation, so bad requests can't use up the merchant's allowance (code review N2); each create is one Arkiv write
    await sharedRateLimit(`vouchers:${access.merchant.toLowerCase()}`, 30, 60 * 60_000, "closed");
    const voucher = voucherJson(await createVoucher(access.merchant, input));
    await auditV1(access, "vouchers.create", voucher.id);
    return ok(voucher, 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "invoices:read");
    return ok({ vouchers: (await listVouchers(merchant)).map(voucherJson) });
  });
}
