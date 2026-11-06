// Payment pages (FR-GW-2, FR-GW-3) in the dashboard Shell: a builder with a live preview, and the merchant's pages.
// Behind sign-in; our server reads the signed-in merchant's pages from the gateway's own module (lib/server/pages.ts).
import { connection } from "next/server";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Account, EditorialHeader, Problem, SignedOut } from "@/components/gateway/Frame";
import { PagesScreen } from "@/components/gateway/Pages";
import { Shell } from "@/components/dashboard/Shell";
import { authSecret } from "@/lib/auth";
import { publicOrigin } from "@/lib/config";
import { merchantPages, originOf, readFailure } from "@/lib/gateway-server";
import { currentMerchant } from "@/lib/merchant-session";
import { merchantName } from "@/lib/server/http";

const header = (
  <EditorialHeader label="Payment pages" lede="Your logo, your colour, your items. Customers pick what they want on one page and pay on the hosted checkout.">
    A shop page <span className="emphasis">without</span> a shop.
  </EditorialHeader>
);

export default function PagesPage() {
  return (
    <Suspense
      fallback={
        <Shell active="pages">
          {header}
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading your pages…</p>
        </Shell>
      }
    >
      <Pages />
    </Suspense>
  );
}

async function Pages() {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const h = await headers();
  const result = await merchantPages(merchant).then(
    (pages) => ({ pages }),
    (error: unknown) => ({ error: readFailure("Pages", error) }),
  );
  return (
    <Shell active="pages" account={<Account merchant={merchant} />}>
      {header}
      {"error" in result ? (
        <div className="px-4 py-6 md:px-8">
          <Problem>{result.error}</Problem>
        </div>
      ) : (
        <PagesScreen pages={result.pages} origin={publicOrigin(originOf(h))} merchantName={merchantName(merchant)} />
      )}
    </Shell>
  );
}
