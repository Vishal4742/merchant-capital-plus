// Vouchers (FR-GW-12) in the dashboard Shell. Behind sign-in; our server reads the signed-in merchant's codes from the
// gateway's own module (claude-contracts' lib/server/vouchers.ts).
import { connection } from "next/server";
import { Suspense } from "react";
import { Account, EditorialHeader, Problem, SignedOut } from "@/components/gateway/Frame";
import { VouchersScreen, type VoucherRow } from "@/components/gateway/Vouchers";
import { Shell } from "@/components/dashboard/Shell";
import { authSecret } from "@/lib/auth";
import { istText, voucherStatus } from "@/lib/gateway-money";
import { merchantVouchers, readFailure } from "@/lib/gateway-server";
import { currentMerchant } from "@/lib/merchant-session";

const header = (
  <EditorialHeader label="Vouchers" lede="Percent or a fixed amount off, with an end date and a usage limit. Each code is also recorded on Arkiv, where it expires with the code.">
    Reward with <span className="emphasis">a code.</span>
  </EditorialHeader>
);

export default function VouchersPage() {
  return (
    <Suspense
      fallback={
        <Shell active="vouchers">
          {header}
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading your codes…</p>
        </Shell>
      }
    >
      <Vouchers />
    </Suspense>
  );
}

async function Vouchers() {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const result = await merchantVouchers(merchant).then(
    (vouchers): { rows: VoucherRow[] } => ({ rows: vouchers.map((v) => ({ ...v, expiresText: istText(v.expires_at), status: voucherStatus(v) })) }),
    (error: unknown) => ({ error: readFailure("Vouchers", error) }),
  );
  return (
    <Shell active="vouchers" account={<Account merchant={merchant} />}>
      {header}
      {"error" in result ? (
        <div className="px-4 py-6 md:px-8">
          <Problem>{result.error}</Problem>
        </div>
      ) : (
        <VouchersScreen vouchers={result.rows} />
      )}
    </Shell>
  );
}
