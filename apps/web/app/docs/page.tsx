// Developer docs (FR-GW-8): how a payment works, the quickstart, the pay button with a live preview, the server SDK
// (and curl), webhooks, the API reference, currencies, limits, errors and test mode. Public and prerendered, except
// the keys box, which streams in. No new browser code: callouts, tags and the closed reference groups are plain HTML.
// Every endpoint, limit and message comes from the code via lib/docs-reference.ts (test/docs-reference.test.mjs).
// The keys box never shows a key, not even its start (security review 006 F5): it links a signed-in merchant to the
// API keys screen (/merchant/developers, FR-GW-6), and says whether this server has the demo shop's key, by fingerprint.
import { headers } from "next/headers";
import { Suspense } from "react";
import { buttonClasses } from "@/components/Button";
import { ButtonPreview } from "@/components/docs/ButtonPreview";
import { API_ANCHORS, ApiReference, Currencies, Errors, Events, Limits, TestScenarios } from "@/components/docs/Reference";
import { HowItWorks, Quickstart } from "@/components/docs/Start";
import * as code from "@/components/docs/snippets";
import { Callout, Code, DocTable, Rich, Section, Snippet, card, grain, textLink } from "@/components/docs/ui";
import { keyFingerprint, merchantConfig, publicOrigin } from "@/lib/config";
import { EVENT_FIELDS, FX_CURRENCIES, LIMITS } from "@/lib/docs-reference";
import { currentMerchant } from "@/lib/merchant-session";
import { USDT } from "@/lib/usdt";

const SECTIONS = [
  { id: "how", label: "How it works" },
  { id: "quickstart", label: "Quickstart" },
  { id: "button", label: "Pay button" },
  { id: "sdk", label: "Server SDK" },
  { id: "webhooks", label: "Webhooks" },
  { id: "api", label: "API reference" },
  { id: "fx", label: "Currencies and FX" },
  { id: "limits", label: "Limits" },
  { id: "errors", label: "Errors" },
  { id: "test-mode", label: "Test mode" },
  { id: "go-live", label: "Before you go live" },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const numbered = (id: SectionId) => {
  const i = SECTIONS.findIndex((s) => s.id === id);
  return { id, number: String(i + 1).padStart(2, "0"), label: SECTIONS[i].label };
};

// smooth anchor jumps on this page only, and never for someone who asked for less motion
const SMOOTH = "@media (prefers-reduced-motion: no-preference) { html:has(#docs) { scroll-behavior: smooth; } }";

export default function DocsPage() {
  return (
    <main id="docs" className="pb-24">
      <style>{SMOOTH}</style>
      <TopBar />
      <Masthead />
      {/* grid-cols-1 is minmax(0, 1fr): the chip row scrolls inside the column instead of widening it */}
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-8 px-4 md:grid-cols-[200px_minmax(0,1fr)] md:gap-12 md:px-8">
        <SectionNav />
        <div className="grid min-w-0 gap-24 md:pt-12">
          <HowItWorks {...numbered("how")} />
          <Quickstart {...numbered("quickstart")} />
          <PayButton />
          <ServerSdk />
          <Webhooks />
          <Section {...numbered("api")} title="API reference" lede={<ApiLede />}>
            <ApiReference />
          </Section>
          <Section {...numbered("fx")} title={<>Price in your currency, <span className="emphasis">get USDT.</span></>} lede={<FxLede />}>
            <Currencies />
            <FxRules />
          </Section>
          <Section {...numbered("limits")} title="Limits" lede="Testnet limits, the same for every merchant.">
            <Limits />
          </Section>
          <Section {...numbered("errors")} title="Errors" lede="Status codes you can branch on, and messages you can show.">
            <Errors />
          </Section>
          <TestMode />
          <GoLive />
        </div>
      </div>
    </main>
  );
}

function TopBar() {
  return (
    <header className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 pt-4 md:px-8">
      <span className="flex items-center gap-3">
        {/* plain <a>: a full load, so leaving the strict CSP of /docs never carries it to / or /proofs (security R2-F3) */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the full load is the point (see above) */}
        <a href="/" className="title inline-flex min-h-11 items-center whitespace-nowrap">
          Merchant Capital+
        </a>
        <span className="eyebrow text-ink-muted">Docs</span>
      </span>
      {/* plain <a>: a full load, so /merchant runs under its own CSP (security review 005 F-N4) */}
      <a href="/merchant" className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4">
        Dashboard
      </a>
    </header>
  );
}

const FACTS = [
  { big: `${LIMITS.minPaymentUsdt.replace(".00", "")}–${LIMITS.maxPaymentUsdt.replace(".00", "")}`, small: "USDT per payment" },
  { big: String(FX_CURRENCIES.length), small: `price currencies, locked ${LIMITS.quoteLockMinutes} min` },
  { big: "0", small: "network fee for customers at checkout" },
  { big: "HMAC", small: "SHA-256 signed webhooks" },
];

function Masthead() {
  return (
    <header className={`mt-4 border-y border-hairline ${grain}`}>
      <div className="mx-auto grid max-w-[1240px] gap-4 px-4 pt-10 pb-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-12 md:px-8 md:pt-16 md:pb-12">
        <span className="eyebrow self-start border-t border-ink pt-3 text-ink-muted">Developers / Docs</span>
        <div className="grid gap-5">
          <h1 className="max-w-[14ch] text-[42px] leading-[0.98] font-medium tracking-[-0.045em] md:text-[76px]">
            Accept USDT in <br />
            <span className="emphasis text-accent">three steps.</span>
          </h1>
          <p className="max-w-[560px] text-lg text-ink-muted">
            Your customers pay in USDT on a hosted checkout and pay no network fee. Each payment settles straight to your wallet. Everything here runs on
            Whitechain testnet with test USDT.
          </p>
          <dl className="mt-4 grid grid-cols-2 border-t border-hairline md:grid-cols-4">
            {FACTS.map((fact, i) => (
              <div key={fact.small} className={`grid gap-1 border-hairline py-4 pr-4 ${i % 2 ? "max-md:border-l max-md:pl-4" : ""} ${i ? "md:border-l md:pl-4" : ""}`}>
                <dt className="order-2 text-sm text-ink-muted">{fact.small}</dt>
                <dd className="order-1 text-[28px] leading-none font-medium tracking-[-0.03em] text-accent md:text-[34px]">{fact.big}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </header>
  );
}

/** Sticky on every screen: a row of chips that scrolls sideways on a phone, a numbered list from md up. */
function SectionNav() {
  return (
    <nav
      aria-label="On this page"
      className="sticky top-0 z-10 -mx-4 min-w-0 border-b border-hairline bg-ground/90 px-4 py-2 backdrop-blur md:mx-0 md:max-h-dvh md:self-start md:overflow-y-auto md:border-0 md:bg-transparent md:px-0 md:pt-12 md:backdrop-blur-none"
    >
      <span className="eyebrow mb-3 hidden text-ink-muted md:block">On this page</span>
      <ol className="flex gap-2 overflow-x-auto md:grid md:gap-0.5 md:overflow-visible">
        {SECTIONS.map((s, i) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              className="lift flex min-h-11 items-center gap-2 rounded-pill border border-hairline bg-surface px-3 text-sm whitespace-nowrap text-ink hover:border-accent md:rounded-sm md:border-transparent md:bg-transparent md:px-2 md:text-ink-muted md:hover:text-ink"
            >
              <span className="eyebrow text-accent">{String(i + 1).padStart(2, "0")}</span>
              {s.label}
            </a>
            {/* the reference's own anchors, from md up; a phone's chip row keeps one chip per section */}
            {s.id === "api" && (
              <ul className="ml-7 hidden border-l border-hairline md:grid">
                {API_ANCHORS.map((a) => (
                  <li key={a.id}>
                    <a href={`#${a.id}`} className="flex min-h-8 items-center pl-3 text-[13px] text-ink-muted hover:text-ink">
                      {a.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const BUTTON_ATTRIBUTES: [string, string][] = [
  ["data-session", "A checkout id from your server. A press opens `/checkout/{id}` on the gateway that served the script."],
  ["data-link", "A payment link's slug instead. A press opens `/l/{slug}`."],
  ["data-label", "The button's text. Default `Pay with USDT`."],
  ["data-mc-session, data-mc-link", "The same, on an element of your own. Load the script once without `data-session`; one click listener handles every marked element, even ones rendered later."],
];

function PayButton() {
  return (
    <Section
      {...numbered("button")}
      title={<>One script tag, <span className="emphasis">one button.</span></>}
      lede="The button opens the hosted checkout. The amount comes from the checkout your server made, never from the page, and the button needs no key."
    >
      <Snippet code={code.BUTTON} name="the pay button snippet" file="your-page.html" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={card}>
          <span className="eyebrow text-ink-muted">Live preview · this page, strict CSP</span>
          <ButtonPreview />
        </div>
        <div className={card}>
          <span className="eyebrow text-ink-muted">Good to know</span>
          <ul className="grid list-disc gap-2 pl-5 text-sm text-ink-muted">
            <li>
              Ids are 1 to 64 letters, digits, <Code>-</Code> and <Code>_</Code>. Anything else renders nothing and logs a console error.
            </li>
            <li>Put the tag in the body, where the button should appear. Use one gateway per page: the first copy of the script handles every button.</li>
            <li>The button styles itself inline, so a strict style-src CSP keeps it. To change its look, use your own element instead.</li>
            <li>
              A click handler of yours that calls <Code>event.preventDefault()</Code> stops the redirect.
            </li>
            <li>
              Strip <Code>data-mc-*</Code> attributes from anything your users can post, or someone could add a button for their own checkout.
            </li>
          </ul>
        </div>
      </div>
      <DocTable
        caption="Pay button attributes"
        columns={[
          { label: "Attribute", width: "w-[30%]" },
          { label: "What it does", width: "w-[70%]" },
        ]}
        rows={BUTTON_ATTRIBUTES.map(([name, what]) => ({
          key: name,
          cells: [
            <code key="name" className="data text-ink">
              {name}
            </code>,
            <span key="what" className="text-ink-muted">
              <Rich text={what} />
            </span>,
          ],
        }))}
      />
      <Snippet code={code.OWN_ELEMENT} name="the own-element snippet" file="your own element" />
    </Section>
  );
}

const SDK_OPTIONS: [string, string, string][] = [
  ["baseUrl", "Required", "The gateway's https origin (http only for localhost). No user:pass, ?query or #hash."],
  ["timeoutMs", "10000", "Per request."],
  ["maxRetries", "2", "Network errors and 5xx answers are retried, with the same idempotencyKey. A 4xx never is."],
  ["fetch", "global fetch", "Your own fetch, for tests or a proxy."],
];

function ServerSdk() {
  return (
    <Section
      {...numbered("sdk")}
      title={<>Create, read and list, <span className="emphasis">from your server.</span></>}
      lede={
        <>
          <Code>@merchant-capital/sdk</Code> is TypeScript with no dependencies. It holds your secret key, so it refuses to run in a browser, refuses a{" "}
          <Code>pk_</Code> key and talks only to an https gateway.
        </>
      }
    >
      <Callout>
        The SDK lives in the repo&apos;s <Code>packages/sdk</Code> and isn&apos;t published yet, so there&apos;s nothing to install from npm. curl works
        today: the same calls are below, and every endpoint is in the API reference.
      </Callout>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start">
        <div className="grid gap-3">
          <h3 className="title">Your server&apos;s environment</h3>
          <p className="text-sm text-ink-muted">
            Your test gateway URL is under Test mode below. Make a secret key on the{" "}
            <a href="/merchant/developers" className={textLink}>
              Developers screen
            </a>
            , and copy the webhook secret when you add your endpoint there. Both are shown once.
          </p>
          <Snippet code={code.ENV} name="the environment variables" file=".env (server only)" />
          <Callout tone="warning">
            <Code>sk_</Code> keys stay on your server: never in a browser, an app or a repo. Revoke a leaked key on the Developers screen; it stops
            working at once.
          </Callout>
        </div>
        <div className="grid gap-3">
          <h3 className="title">Create a checkout</h3>
          <Snippet code={code.CREATE} name="the create snippet" file="sessions.create" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-3">
          <h3 className="title">Read it back</h3>
          <p className="text-sm text-ink-muted">Polling works too: an order is paid when the status is paid and the amount is yours.</p>
          <Snippet code={code.RETRIEVE} name="the retrieve snippet" file="sessions.retrieve" />
        </div>
        <div className="grid gap-3">
          <h3 className="title">List payments</h3>
          <p className="text-sm text-ink-muted">Every payment to your wallet, newest first, with how much of it was refunded.</p>
          <Snippet code={code.LIST} name="the list snippet" file="payments.list" />
        </div>
      </div>
      <div className="grid gap-3">
        <h3 className="title">Or with curl</h3>
        <p className="max-w-[70ch] text-sm text-ink-muted">
          The same create and read with no SDK. Send <Code>reference</Code> where the SDK says <Code>orderId</Code>, and keep the{" "}
          <Code>Idempotency-Key</Code> when you retry.
        </p>
        <Snippet code={code.CURL} name="the curl requests" file="curl" />
      </div>
      <div className="grid gap-4">
        <h3 className="title">Options and errors</h3>
        <DocTable
          caption="Gateway options"
          columns={[
            { label: "Option", width: "w-[20%]" },
            { label: "Default", width: "w-[20%]" },
            { label: "What it does", width: "w-[60%]" },
          ]}
          rows={SDK_OPTIONS.map(([name, fallback, what]) => ({
            key: name,
            cells: [
              <code key="name" className="data text-ink">
                {name}
              </code>,
              <span key="default" className="data text-ink-muted">
                {fallback}
              </span>,
              <span key="what" className="text-ink-muted">
                {what}
              </span>,
            ],
          }))}
        />
        <p className="max-w-[70ch] text-sm text-ink-muted">
          A failed call throws <Code>GatewayError</Code> with the gateway&apos;s <Code>status</Code> and message (see Errors). Redirects are refused, so use the
          gateway&apos;s final URL as <Code>baseUrl</Code>. If you price in a currency and the checkout comes back without a quote in it,{" "}
          <Code>sessions.create</Code> throws rather than charge 20 EUR as 20 USDT.
        </p>
      </div>
    </Section>
  );
}

const ATTEMPTS = [
  { at: "At once", what: "Attempt 1" },
  { at: `${LIMITS.webhookRetryMinutes[0]} min later`, what: "Attempt 2" },
  { at: `${LIMITS.webhookRetryMinutes[1]} min later`, what: "Attempt 3" },
  { at: `${LIMITS.webhookRetryMinutes[2]} min later`, what: "Attempt 4, the last" },
];

function Webhooks() {
  return (
    <Section
      {...numbered("webhooks")}
      title={<>Know it&apos;s paid, <span className="emphasis">signed.</span></>}
      lede="When a checkout is paid, from your server's checkout, a payment link or a page, we POST payment.succeeded to each of your endpoints."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className={card}>
          <span className="eyebrow text-ink-muted">Add an endpoint</span>
          <p className="text-sm text-ink-muted">
            On the{" "}
            <a href="/merchant/developers" className={textLink}>
              Developers screen
            </a>
            , or <Code>POST /api/v1/webhooks</Code> with your secret key. An https URL on a public host, up to {LIMITS.webhookEndpointsMax} per merchant. The{" "}
            <Code>whsec_</Code> secret is shown once.
          </p>
        </div>
        <div className={card}>
          <span className="eyebrow text-ink-muted">Answer fast</span>
          <p className="text-sm text-ink-muted">Any 2xx within 5 seconds counts as delivered. We don&apos;t follow redirects, and we never read your answer, only its status.</p>
        </div>
        <div className={card}>
          <span className="eyebrow text-ink-muted">Expect repeats</span>
          <p className="text-sm text-ink-muted">
            Retries and Resend send the same body with the same event <Code>id</Code>. Skip an id you have already handled.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="title">Events</h3>
        <Events />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="grid gap-3">
          <h3 className="title">The request</h3>
          <Snippet code={code.EVENT_HEADERS} name="the webhook request headers" file="headers" />
          <Snippet code={code.EVENT} name="the payment.succeeded body" file="payment.succeeded" />
        </div>
        <div className="grid gap-3">
          <h3 className="title">What&apos;s in data</h3>
          <DocTable
            caption="payment.succeeded data fields"
            columns={[
              { label: "Field", width: "w-[34%]" },
              { label: "Meaning", width: "w-[66%]" },
            ]}
            rows={EVENT_FIELDS.map(([name, meaning]) => ({
              key: name,
              cells: [
                <code key="name" className="data text-ink">
                  {name}
                </code>,
                <span key="meaning" className="text-ink-muted">
                  {meaning}
                </span>,
              ],
            }))}
          />
          <p className="text-sm text-ink-muted">
            <Code>created</Code> is unix seconds. Amounts may come formatted differently from what you stored, so compare them with <Code>sameAmount</Code>, not{" "}
            <Code>===</Code>.
          </p>
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="title">Verify, then fulfil</h3>
        <p className="max-w-[70ch] text-sm text-ink-muted">
          The <Code>MC-Signature</Code> header is <Code>t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</Code>, where the hex is an HMAC-SHA256 of{" "}
          <Code>&lt;t&gt;.&lt;raw body&gt;</Code> with your endpoint&apos;s secret. <Code>constructEvent</Code> compares it in constant time and refuses an
          event more than {LIMITS.webhookToleranceSeconds / 60} minutes old or ahead (<Code>toleranceSec</Code>, default {LIMITS.webhookToleranceSeconds}).
        </p>
        <Callout tone="warning">
          Verify the raw body, before any JSON parsing: parsed and re-serialized JSON won&apos;t match the signature. Use <Code>await req.text()</Code>,
          or <Code>express.raw()</Code> in Express.
        </Callout>
        <Snippet code={code.WEBHOOK} name="the webhook snippet" file="app/api/webhooks/route.ts" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className={card}>
          <span className="eyebrow text-ink-muted">Retries</span>
          <ol className="grid gap-0 sm:grid-cols-4">
            {ATTEMPTS.map((a, i) => (
              <li key={a.what} className="relative grid gap-1 border-hairline py-3 max-sm:border-l max-sm:pl-4 sm:border-t sm:pt-4 sm:pr-3">
                <span aria-hidden className={`absolute size-2.5 rounded-full max-sm:top-4 max-sm:-left-[5.5px] sm:-top-[5.5px] sm:left-0 ${i ? "bg-accent" : "bg-positive"}`} />
                <span className="data text-ink">{a.at}</span>
                <span className="text-xs text-ink-muted">{a.what}</span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-ink-muted">
            A delivery that never gets a 2xx is retried {LIMITS.webhookRetryMinutes.length} times, then marked failed. Each attempt is signed again with a fresh{" "}
            <Code>t</Code>. Resend any delivery from the Developers screen.
          </p>
        </div>
        <div className={card}>
          <span className="eyebrow text-ink-muted">Test events</span>
          <p className="text-sm text-ink-muted">
            &ldquo;Send test event&rdquo; on the Developers screen sends a signed payment.succeeded whose data is only <Code>{'{"test": true}'}</Code>. Your handler
            should answer 2xx and do nothing.
          </p>
          <Snippet code={code.TEST_EVENT} name="the test event body" file="test event" />
        </div>
      </div>
    </Section>
  );
}

function ApiLede() {
  return (
    <>
      Paths are on your gateway URL, and bodies are JSON. Your server needs the first group; the other two are here for completeness. Checkout,
      payment and webhook amounts come back with at least two decimals (<Code>&quot;25.00&quot;</Code>); the dashboard resources use snake_case and may
      drop trailing zeros (<Code>&quot;25&quot;</Code>). Times are ISO 8601.
    </>
  );
}

function FxLede() {
  return (
    <>
      Set a price in any of these and the customer pays USDT at a rate locked for the checkout. Rates come from Frankfurter (ECB and central-bank reference
      rates).
    </>
  );
}

const FX_RULES = [
  { big: `${LIMITS.quoteLockMinutes} min`, text: `A quote is locked for ${LIMITS.quoteLockMinutes} minutes, and a checkout priced in EUR, GBP, INR, AED or SGD ends with it.` },
  { big: `±${LIMITS.fxBandPercent}%`, text: `A rate outside its band (AED: its 3.6725 peg ±${LIMITS.aedPegPercent}%) or older than ${LIMITS.rateMaxAgeDays} days is refused: 503, nothing is created. Rates are cached for ${LIMITS.rateCacheMinutes} minutes.` },
  { big: "↑ 0.01", text: "USDT is rounded up to the cent, so you never get less than your price. 20.00 EUR at 0.88875 per USD is 22.51 USDT." },
  { big: "1 : 1", text: `USD is USDT at 1:1. Price in USD or USDT and the checkout keeps its ${LIMITS.checkoutMinutes} minutes, with no rate to fetch.` },
];

function FxRules() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {FX_RULES.map((rule) => (
        <li key={rule.big} className={card}>
          <span className="text-[34px] leading-none font-medium tracking-[-0.03em] text-accent">{rule.big}</span>
          <p className="text-sm text-ink-muted">{rule.text}</p>
        </li>
      ))}
    </ul>
  );
}

function TestMode() {
  return (
    <Section
      {...numbered("test-mode")}
      title={<>Test mode, <span className="emphasis">all the way.</span></>}
      lede="Everything runs on Whitechain testnet with test USDT. Keys are test keys (pk_test_, sk_test_), and no real money moves."
    >
      <ul className="grid gap-4 md:grid-cols-3">
        <li className={card}>
          <span className="eyebrow text-ink-muted">Chain</span>
          <p className="text-sm text-ink-muted">Whitechain testnet (chain id 1874). Payments, refunds and reports are read from it.</p>
        </li>
        <li className={card}>
          <span className="eyebrow text-ink-muted">Money</span>
          <p className="text-sm text-ink-muted">
            Test USDT (&ldquo;Tether USD&rdquo;, 6 decimals) at <span className="data break-all text-ink">{USDT}</span>.
          </p>
        </li>
        <li className={card}>
          <span className="eyebrow text-ink-muted">Fees</span>
          <p className="text-sm text-ink-muted">Customers pay no network fee: they sign once, and the gateway sends the payment on chain for them.</p>
        </li>
      </ul>
      <div className="grid gap-6 md:grid-cols-2">
        <section className={card} aria-labelledby="keys">
          <h3 id="keys" className="eyebrow text-ink-muted">
            Test keys
          </h3>
          <Suspense fallback={<p className="text-sm text-ink-muted">Checking who is signed in…</p>}>
            <TestKeys />
          </Suspense>
        </section>
        <section className={card} aria-labelledby="simulate">
          <h3 id="simulate" className="eyebrow scroll-mt-24 text-ink-muted md:scroll-mt-10">
            Simulate a payment
          </h3>
          <p className="text-sm text-ink-muted">Opens a test checkout for the demo shop (25.00 USDT, test money), the same way your server would.</p>
          <form method="post" action="/api/demo-checkout">
            <button type="submit" className={buttonClasses("primary")}>
              Simulate a payment
            </button>
          </form>
        </section>
      </div>
      <div className="grid gap-3">
        <h3 className="title">Test scenarios</h3>
        <p className="max-w-[70ch] text-sm text-ink-muted">How to make each outcome happen before a real customer does, and what comes back. The codes and messages are the gateway&apos;s own.</p>
        <TestScenarios />
      </div>
    </Section>
  );
}

const CHECKLIST = [
  "Mark an order paid only from payment.succeeded, or from sessions.retrieve saying paid. The browser coming back to your returnUrl is a hint, not proof.",
  "Find the order by the checkout id you saved, and check the amount with `sameAmount`. Never credit a session id the browser hands you.",
  "Verify the raw request body, before any JSON parsing.",
  "Skip an event id you have already handled, and record it in the same transaction that marks the order paid.",
  "Ignore test events: their `data` is `{\"test\": true}`.",
  "Keep `sk_test_` keys on your server. Revoke a leaked key on the Developers screen; it stops working at once.",
  'Send amounts as strings like "25.00", never floats, and send an `Idempotency-Key` when you retry a create.',
  "Answer webhooks with a 2xx within 5 seconds, and do slow work after.",
  "Strip `data-mc-*` attributes from anything your users can post.",
];

function GoLive() {
  return (
    <Section {...numbered("go-live")} title="Before you go live" lede="Live mode isn't open yet, so everything here is test mode. Build for it now: each line keeps a shop from shipping an order it wasn't paid for.">
      <ol className="grid gap-x-8 md:grid-cols-2">
        {CHECKLIST.map((item, i) => (
          <li key={item} className="flex gap-4 border-t border-hairline py-4 text-sm">
            <span className="eyebrow pt-0.5 text-accent">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-ink-muted">
              <Rich text={item} />
            </span>
          </li>
        ))}
      </ol>
    </Section>
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
      <Snippet code={env} name="the gateway URL" file=".env" />
      {/* plain <a>: a full load, so /merchant/developers runs under its own CSP (security review 005 F-N4) */}
      {!merchant ? (
        <p className="text-sm text-ink-muted">
          <a href="/merchant/developers" className={textLink}>
            Sign in to the dashboard
          </a>{" "}
          with your shop&apos;s wallet to create your test keys.
        </p>
      ) : (
        <p className="text-sm text-ink-muted">
          <a href="/merchant/developers" className={textLink}>
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
