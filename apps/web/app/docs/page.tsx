// Developer docs (FR-GW-8): add the gateway in three steps (pay button, a checkout from your server, webhooks), the
// test keys, and "Simulate a payment" (test mode). Public and prerendered, except the keys box, which streams in.
// The keys box never shows a key, not even its start (security review 006 F5): it links a signed-in merchant to the
// API keys screen (/merchant/developers, FR-GW-6), and says whether this server has the demo shop's key, by fingerprint.
import { headers } from "next/headers";
import { Suspense } from "react";
import { buttonClasses } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { keyFingerprint, merchantConfig, publicOrigin } from "@/lib/config";
import { currentMerchant } from "@/lib/merchant-session";

const BUTTON_SNIPPET = `<!-- data-session: the checkout id your server made in step 2,
     or data-link: a payment link's slug -->
<script src="GATEWAY_URL/v1/button.js"
        data-session="SESSION_ID"></script>`;

const SERVER_SNIPPET = `import { Gateway } from "@merchant-capital/sdk";

const gateway = new Gateway(process.env.GATEWAY_SECRET_KEY!, {
  baseUrl: process.env.GATEWAY_URL!,
});

// Price in USDT, USD, EUR, GBP, INR, AED or SGD.
// Checkout charges USDT at a rate locked for the checkout.
const session = await gateway.sessions.create({
  amount: "20.00",
  currency: "EUR",
  orderId: "order-42",
  returnUrl: "https://shop.example/thanks",
});
// Save session.id with your order: webhooks name the
// checkout by it. Send the customer to session.url (a 303
// redirect), or give session.id to the pay button.`;

const WEBHOOK_SNIPPET = `import { constructEvent, SIGNATURE_HEADER } from "@merchant-capital/sdk";

// A Next.js route handler. Pass the raw body:
// re-serialized JSON won't verify.
export async function POST(request: Request) {
  let event;
  try {
    event = constructEvent(
      await request.text(),
      request.headers.get(SIGNATURE_HEADER),
      process.env.GATEWAY_WEBHOOK_SECRET!,
    );
  } catch {
    return new Response("bad signature", { status: 400 });
  }
  // a test event, or one you already handled: do nothing
  if ("test" in event.data || (await seen(event.id))) {
    return new Response("ok");
  }
  if (event.type === "payment.succeeded") {
    // find the order by the checkout id you saved, never by
    // reference alone, and check it was paid in full
    const order = await orderByCheckout(event.data.id);
    if (order && event.data.amount === order.amountUsdt) {
      await markPaid(order.id);
    }
  }
  return new Response("ok");
}`;

const card = "grid min-w-0 content-start gap-4 rounded-md border border-hairline bg-surface p-6 shadow-card";
const soon = "justify-self-start rounded-pill border border-hairline px-3 py-0.5 text-xs font-medium text-ink-muted";

function Snippet({ code, name }: { code: string; name: string }) {
  return (
    <div className="grid min-w-0 gap-1">
      <div className="flex justify-end">
        <CopyButton text={code} name={name} />
      </div>
      {/* wraps on a phone, scrolls from md up; focusable and named, so a keyboard can scroll it (UX review 006 F3) */}
      <pre tabIndex={0} role="region" aria-label={`Code: ${name}`} className="data overflow-x-auto rounded-sm bg-surface-sunk p-4 break-words whitespace-pre-wrap md:whitespace-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 pt-6 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-4">
        {/* plain <a>: a full load, so leaving the strict CSP of /docs never carries it to / or /proofs (security R2-F3) */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the full load is the point (see above) */}
        <a href="/" className="title inline-flex min-h-11 items-center whitespace-nowrap">
          Merchant Capital+
        </a>
        {/* plain <a>: a full load, so /merchant runs under its own CSP (security review 005 F-N4) */}
        <a href="/merchant" className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4">
          Dashboard
        </a>
      </header>

      <h1 className="display mt-10">Accept USDT in three steps</h1>
      <p className="mt-3 max-w-xl text-ink-muted">
        Your customers pay in USDT on a hosted checkout and pay no network fee. Each payment settles straight to your wallet. Everything here runs on
        Whitechain testnet with test USDT.
      </p>

      <ol className="mt-10 grid gap-6">
        <li className={card}>
          <span className="data text-accent">01</span>
          <h2 className="title">Add a pay button</h2>
          <p className="text-sm text-ink-muted">One script tag opens the hosted checkout. The amount comes from the checkout your server made, never from the page.</p>
          <span className={soon}>Available when the SDK ships</span>
          <Snippet code={BUTTON_SNIPPET} name="the pay button snippet" />
        </li>
        <li className={card}>
          <span className="data text-accent">02</span>
          <h2 className="title">Create a checkout on your server</h2>
          <p className="text-sm text-ink-muted">Use your secret key on your server only. Send amounts as strings.</p>
          <Snippet code={SERVER_SNIPPET} name="the server snippet" />
        </li>
        <li className={card}>
          <span className="data text-accent">03</span>
          <h2 className="title">Confirm payments with webhooks</h2>
          <p className="text-sm text-ink-muted">
            We send <code className="data">payment.succeeded</code> and <code className="data">payment.refunded</code> with an{" "}
            <code className="data">MC-Signature: t=…,v1=…</code> header: an HMAC-SHA256 of <code className="data">&lt;t&gt;.&lt;raw body&gt;</code> with your webhook
            secret. Events more than 5 minutes old are refused.
          </p>
          <span className={soon}>Add your endpoint on the API keys screen; every paid checkout sends payment.succeeded</span>
          <Snippet code={WEBHOOK_SNIPPET} name="the webhook snippet" />
        </li>
      </ol>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className={card} aria-labelledby="keys">
          <h2 id="keys" className="label text-ink-muted">
            Test keys
          </h2>
          <Suspense fallback={<p className="text-sm text-ink-muted">Checking who is signed in…</p>}>
            <TestKeys />
          </Suspense>
        </section>
        <section className={card} aria-labelledby="simulate">
          <h2 id="simulate" className="label text-ink-muted">
            Simulate a payment
          </h2>
          <p className="text-sm text-ink-muted">Opens a test checkout for the demo shop (25.00 USDT, test money), the same way your server would.</p>
          <form method="post" action="/api/demo-checkout">
            <button type="submit" className={buttonClasses("primary")}>
              Simulate a payment
            </button>
          </form>
        </section>
      </div>

      <section className="mt-10 grid gap-2" aria-labelledby="checks">
        <h2 id="checks" className="label text-ink-muted">
          Before you go live
        </h2>
        <ul className="grid list-disc gap-1 pl-5 text-sm text-ink-muted">
          <li>Only payment.succeeded means paid. The browser&apos;s redirect back to your shop is a hint, not proof.</li>
          <li>Webhooks can arrive twice: skip an event id you have already handled.</li>
          <li>Verify the raw request body, before any JSON parsing.</li>
          <li>Amounts are strings like &quot;25.00&quot;, never floats.</li>
        </ul>
      </section>
    </main>
  );
}

/** The gateway URL for the env file, and the way to the API keys screen (never any key, not even its start). */
async function TestKeys() {
  const h = await headers(); // a request-time read first, so the sign-in check's clock never runs while prerendering
  const merchant = await currentMerchant();
  const origin = publicOrigin(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost"}`);
  const config = merchantConfig();
  const env = `GATEWAY_URL=${origin}`;
  return (
    <>
      <Snippet code={env} name="the gateway URL" />
      {/* plain <a>: a full load, so /merchant/developers runs under its own CSP (security review 005 F-N4) */}
      {!merchant ? (
        <p className="text-sm text-ink-muted">
          <a href="/merchant/developers" className="text-accent underline underline-offset-4">
            Sign in to the dashboard
          </a>{" "}
          with your shop&apos;s wallet to create your test keys.
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          <a href="/merchant/developers" className="text-accent underline underline-offset-4">
            Create and revoke your keys
          </a>{" "}
          on the API keys screen. Put a secret key in GATEWAY_SECRET_KEY on your shop&apos;s server.
        </p>
      )}
      {merchant && config && merchant.toLowerCase() === config.merchant.toLowerCase() && (
        <p className="text-sm text-ink-muted">
          This server also has the demo shop&apos;s key set (SHA-256 fingerprint <span className="data text-ink">{keyFingerprint(config.apiKey)}</span>).
        </p>
      )}
    </>
  );
}
