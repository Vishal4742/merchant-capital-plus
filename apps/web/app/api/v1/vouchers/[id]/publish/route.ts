// POST /api/v1/vouchers/:id/publish: retry the voucher's Arkiv mirror (FR-GW-12, FR-ARK-1; batch 018) → the voucher
// with arkiv_status / arkiv_entity_key / arkiv_tx_hash / arkiv_error. Batch 051 R2-1 invoices:draft (Owner, Operator);
// another workspace's id → 404.
import { handle, ok, sharedRateLimit } from "../../../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../../../lib/server/legacy.ts";
import { publishVoucher, voucherJson } from "../../../../../../lib/server/vouchers.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const access = await legacyAccess(request, "invoices:draft");
    const { id } = await params;
    await sharedRateLimit(`vouchers:${access.merchant.toLowerCase()}`, 30, 60 * 60_000, "closed"); // shared with create: each attempt is one Arkiv write
    const voucher = voucherJson(await publishVoucher(access.merchant, id));
    await auditV1(access, "vouchers.publish", id);
    return ok(voucher);
  });
}
