// Hosted payment link page (FR-GW-1, FR-PAY-7). Server component: the link comes from the gateway through our server,
// so the browser makes no chain reads (FR-PRIV-1). The form posts to /l/{slug}/checkout (no JS needed), which answers
// 303 to the checkout. Still scene only: no three.js and no Nym here (NFR-12).
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { HostedNotice, LinkSheet, LinkSummary } from "@/components/gateway/Hosted";
import { StaticScene } from "@/components/StaticScene";
import { GatewayError, SLUG, type PublicLink } from "@/lib/gateway-client";
import { checkoutMessage, closedLinkCopy } from "@/lib/gateway-forms";
import { gatewayFor } from "@/lib/gateway-server";

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
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  if (!SLUG.test(slug)) notFound();
  let link: PublicLink;
  try {
    link = await gatewayFor(await headers()).publicLink(slug);
  } catch (error) {
    if (error instanceof GatewayError && error.status === 404) notFound();
    return (
      <HostedNotice eyebrow="Payment link" title="We can't open this link right now" action={{ href: `/l/${slug}`, label: "Try again" }}>
        Nothing was charged. Try again in a minute.
      </HostedNotice>
    );
  }
  if (link.status !== "active") {
    const copy = closedLinkCopy(link.status, link.merchant_name);
    // ponytail: the public link has no paid time or receipt id yet (asked of claude-contracts), so no receipt link here
    return (
      <HostedNotice eyebrow={link.merchant_name} title={copy.title} detail={<LinkSummary link={link} />} action={{ href: "/", label: "About Merchant Capital+" }}>
        {copy.body}
      </HostedNotice>
    );
  }
  return <LinkSheet link={link} amount={one(query.amount)} error={checkoutMessage(one(query.error))} />;
}
