// POST /api/v1/vouchers/:id/publish: retry the voucher's Arkiv mirror (FR-GW-12, FR-ARK-1; batch 018) → the voucher
// with arkiv_status / arkiv_entity_key / arkiv_tx_hash / arkiv_error. Dashboard only; another merchant's id → 404.
import { handle, ok, rateLimit, signedInMerchant } from "../../../../../../lib/server/http.ts";
import { publishVoucher, voucherJson } from "../../../../../../lib/server/vouchers.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const { id } = await params;
    rateLimit(`vouchers:${merchant.toLowerCase()}`, 30, 60 * 60_000); // shared with create: each attempt is one Arkiv write
    return ok(voucherJson(await publishVoucher(merchant, id)));
  });
}
