// Payment links (FR-GW-1, FR-GW-3) in the dashboard Shell. Behind sign-in; our server reads the signed-in merchant's
// list from the gateway's own module (claude-contracts' lib/server/links.ts).
import { connection } from "next/server";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Account, EditorialHeader, Problem, SignedOut } from "@/components/gateway/Frame";
import { LinksScreen, type LinkRow } from "@/components/gateway/Links";
import { Shell } from "@/components/dashboard/Shell";
import { authSecret } from "@/lib/auth";
import { publicOrigin } from "@/lib/config";
import { merchantLinks, originOf, readFailure } from "@/lib/gateway-server";
import { currentMerchant } from "@/lib/merchant-session";

const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

const header = (
  <EditorialHeader label="Payment links" lede="An amount, a currency and a line about what it's for. Send it in any chat, or show its QR code at the counter. It works once, or every time.">
    Send a link, <span className="emphasis">get paid.</span>
  </EditorialHeader>
);

export default function LinksPage() {
  return (
    <Suspense
      fallback={
        <Shell active="links">
          {header}
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading your links…</p>
        </Shell>
      }
    >
      <Links />
    </Suspense>
  );
}

async function Links() {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const h = await headers();
  const result = await merchantLinks(merchant).then(
    (links): { rows: LinkRow[] } => ({ rows: links.map((link) => ({ ...link, expiresText: link.expires_at && ist(link.expires_at) })) }),
    (error: unknown) => ({ error: readFailure("Links", error) }),
  );
  return (
    <Shell active="links" account={<Account merchant={merchant} />}>
      {header}
      {"error" in result ? (
        <div className="px-4 py-6 md:px-8">
          <Problem>{result.error}</Problem>
        </div>
      ) : (
        <LinksScreen links={result.rows} origin={publicOrigin(originOf(h))} />
      )}
    </Shell>
  );
}
