// Hosted payment link page (FR-GW-1, FR-PAY-7). Server component: our server reads the link from the gateway's own
// module, so the browser makes no chain reads (FR-PRIV-1). The form posts to /l/{slug}/checkout (no JS needed), which answers
// 303 to the checkout. Still scene only: no three.js and no Nym here (NFR-12).
import { payConfig } from "@/lib/config";
import { warmRelayer } from "@/lib/relay";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { HostedNotice, LinkSheet, LinkSummary } from "@/components/gateway/Hosted";
import { StaticScene } from "@/components/StaticScene";
import { SLUG, type PublicLink } from "@/lib/gateway-client";
import { checkoutMessage, closedLinkCopy } from "@/lib/gateway-forms";
import { logFailure, publicLink } from "@/lib/gateway-server";

// The night and the frame prerender; the link streams in (Cache Components needs params inside Suspense).
export default function LinkPage({ params, searchParams }: PageProps<"/l/[slug]">) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-scene-night px-4 py-12">
      <StaticScene />
      <Suspense fallback={<p className="relative rounded-[28px] bg-surface px-8 py-6 text-ink-muted shadow-float">Opening the payment link…</p>}>
        <LinkLoader params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

async function LinkLoader({ params, searchParams }: PageProps<"/l/[slug]">) {
  await connection(); // read on every request, never in a prerender pass
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  if (!SLUG.test(slug)) notFound();
  let link: PublicLink | null;
  try {
    link = await publicLink(slug);
  } catch (error) {
    logFailure("hosted link page", error);
    return (
      <HostedNotice eyebrow="Payment link" title="We can't open this link right now" action={{ href: `/l/${slug}`, label: "Try again" }}>
        Nothing was charged. Try again in a minute.
      </HostedNotice>
    );
  }
  if (!link) notFound();
  if (link.status !== "active") {
    const copy = closedLinkCopy(link.status, link.merchant_name);
    // a paid link shows when it was paid (paid_at); no receipt link, which would let anyone with the link open it
    return (
      <HostedNotice eyebrow={link.merchant_name} title={copy.title} detail={<LinkSummary link={link} />} action={{ href: "/", label: "About Merchant Capital+" }}>
        {copy.body}
      </HostedNotice>
    );
  }
  warmRelayer(payConfig()?.relayerUrl); // an open link: its customer may pay in a moment (claude-relayer 09:42, throttled)
  return <LinkSheet link={link} amount={one(query.amount)} error={checkoutMessage(one(query.error))} />;
}
