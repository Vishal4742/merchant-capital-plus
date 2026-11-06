// Developers (FR-GW-6, FR-GW-7) in the dashboard Shell: API keys and webhooks. Behind sign-in. The lists are read on
// our server straight from the gateway's own modules (claude-contracts' backend is on main), never with a key or a
// signing secret in them, so this page's HTML and RSC payload can't carry one.
import { connection } from "next/server";
import { Suspense } from "react";
import { Shell } from "@/components/dashboard/Shell";
import { ApiKeys, type KeyRow } from "@/components/gateway/ApiKeys";
import { Account, EditorialHeader, Problem, SignedOut } from "@/components/gateway/Frame";
import { Webhooks, type WebhookRow } from "@/components/gateway/Webhooks";
import { authSecret } from "@/lib/auth";
import { keyOf, webhookOf } from "@/lib/gateway-dev";
import { readFailure } from "@/lib/gateway-server";
import { currentMerchant } from "@/lib/merchant-session";
import { keyJson, listKeys } from "@/lib/server/keys";
import { listWebhooks } from "@/lib/server/webhooks";

const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
/** A retry is at most 30 minutes away: the time is enough. */
const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

const header = (
  <EditorialHeader label="Developers" lede="Keys for your server and the pay button, and the endpoints we tell when a payment succeeds or is refunded. Test mode: test USDT only.">
    Keys and <span className="emphasis">webhooks.</span>
  </EditorialHeader>
);

export default function DevelopersPage() {
  return (
    <Suspense
      fallback={
        <Shell active="keys">
          {header}
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading your keys and webhooks…</p>
        </Shell>
      }
    >
      <Developers />
    </Suspense>
  );
}

type Read<T> = { rows: T[] } | { error: string };

/** One plain sentence for a failed read (logged by the error's name only, NFR-8). */
const readError = (what: string) => (error: unknown) => ({ error: readFailure(what, error) });

async function read(merchant: `0x${string}`): Promise<{ keys: Read<KeyRow>; webhooks: Read<WebhookRow> }> {
  const keys = listKeys(merchant).then((list) => list.map(keyJson));
  const hooks = listWebhooks(merchant);
  // both reads run at once, each with its own error, so one failing still shows the other
  const keyRows = keys
    .then((list): Read<KeyRow> => ({ rows: list.map(keyOf).map((k) => ({ ...k, createdText: ist(k.created_at), lastUsedText: k.last_used_at && ist(k.last_used_at) })) }))
    .catch(readError("API keys"));
  const hookRows = hooks
    .then(
      (list): Read<WebhookRow> => ({
        rows: list.map(webhookOf).map((h) => ({
          ...h,
          createdText: ist(h.created_at),
          deliveries: h.deliveries.map((d) => ({ ...d, atText: ist(d.at), nextText: d.next_attempt_at && istTime(d.next_attempt_at) })),
        })),
      }),
    )
    .catch(readError("Webhooks"));
  return { keys: await keyRows, webhooks: await hookRows };
}

async function Developers() {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const { keys, webhooks } = await read(merchant);
  return (
    <Shell active="keys" account={<Account merchant={merchant} />}>
      {header}
      <div className="grid gap-10 px-4 py-6 md:px-8 md:py-8">
        {"error" in keys ? <Problem>{keys.error}</Problem> : <ApiKeys keys={keys.rows} />}
        {"error" in webhooks ? <Problem>{webhooks.error}</Problem> : <Webhooks hooks={webhooks.rows} />}
      </div>
    </Shell>
  );
}
