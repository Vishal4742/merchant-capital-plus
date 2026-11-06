// The opening of /docs (FR-GW-8): how a payment works, then the Quickstart with what you need first, each step tagged
// with where it runs, and a last step to see the payment arrive. Server components; links are plain <a> (full loads:
// the dashboard runs under its own CSP, security review 005 F-N4).
import * as code from "./snippets";
import { Code, MiniCode, Section, Snippet, WhereTag, card, textLink } from "./ui";
import { FX_CURRENCIES, LIMITS } from "@/lib/docs-reference";

/** A section's anchor, number and nav label, from the page's list. */
type Numbered = { id: string; number: string; label: string };

const FLOW = [
  { who: "Customer", title: "Approves once", text: "On our hosted checkout they approve the exact amount, once. They pay no network fee and need no coin for gas." },
  { who: "Gateway", title: "Sends it on Whitechain", text: "Our relayer sends the payment to the chain and pays the network fee itself." },
  { who: "Your wallet", title: "USDT lands in it", text: "In the same transaction, the price less a 0.10 USDT relay fee goes to your wallet. No payout to wait for." },
  { who: "Your server", title: "Hears it's paid", text: "We POST a signed payment.succeeded to each of your webhook endpoints. Fulfil the order on it." },
];

const FLOW_LIMITS = [
  `${LIMITS.minPaymentUsdt} to ${LIMITS.maxPaymentUsdt} USDT per payment, priced in USDT or one of ${FX_CURRENCIES.length - 1} other currencies.`,
  "Test only: Whitechain testnet and test USDT, so no real money moves.",
  "You refund from your own wallet on the Payments screen; once the refund is synced, payment.refunded is sent.",
];

export function HowItWorks(props: Numbered) {
  return (
    <Section
      {...props}
      title={<>How a payment <span className="emphasis">works.</span></>}
      lede="The customer needs no wallet app and no gas, and the money never sits with us: it reaches you in the payment's own transaction."
    >
      <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {FLOW.map((step, i) => (
          <li key={step.who} className={card}>
            <span className="eyebrow text-ink-muted">
              <span className="text-accent">{String(i + 1).padStart(2, "0")}</span> / {step.who}
            </span>
            <h3 className="title">{step.title}</h3>
            <p className="text-sm text-ink-muted">{step.text}</p>
          </li>
        ))}
      </ol>
      <ul aria-label="Limits" className="grid border-t border-hairline">
        {FLOW_LIMITS.map((line) => (
          <li key={line} className="border-b border-hairline py-3 text-sm text-ink-muted">
            {line}
          </li>
        ))}
      </ul>
    </Section>
  );
}

const NEEDS = [
  {
    label: "Your secret key",
    text: (
      <>
        An <Code>sk_test_</Code> key from the{" "}
        <a href="/merchant/developers" className={textLink}>
          Developers screen
        </a>
        , kept on your server.
      </>
    ),
  },
  {
    label: "A public https URL",
    text: "For webhooks. We only call public hosts, so while you build on your laptop, put a tunnel that gives you an https URL in front of it.",
  },
  {
    label: "Test USDT for payers",
    text: "Paying needs test USDT on Whitechain testnet. The team funds the demo's own wallets and there's no public USDT faucet, so ask the team for test USDT during the hackathon.",
  },
];

type Step = { where: "Server" | "Browser"; title: string; text: string; code?: string; more: { href: string; label: string } };

const STEPS: Step[] = [
  {
    where: "Server",
    title: "Create a checkout",
    text: "With your secret key. Save the checkout's id and amount with your order.",
    code: 'const { id, url, amount } =\n  await gateway.sessions.create({\n    amount: "25.00",\n    orderId: order.id,\n  });',
    more: { href: "#sdk", label: "Server SDK" },
  },
  {
    where: "Browser",
    title: "Send the customer to pay",
    text: "Redirect to the checkout's url, or drop in the pay button. They pay in USDT and pay no network fee.",
    code: '<script src="…/v1/button.js"\n  data-session="SESSION_ID"></script>',
    more: { href: "#button", label: "Pay button" },
  },
  {
    where: "Server",
    title: "Mark the order paid",
    text: "We POST payment.succeeded, signed with MC-Signature. Verify it, check the amount, then fulfil.",
    code: "const event = constructEvent(\n  rawBody, signature, secret);",
    more: { href: "#webhooks", label: "Webhooks" },
  },
  {
    where: "Browser",
    title: "Check it's paid",
    text: "Pay your checkout with test USDT, then look for it on the Payments screen, and for its payment.succeeded delivery, answered 2xx, under your endpoint on the Developers screen.",
    more: { href: "#test-mode", label: "Test mode" },
  },
];

export function Quickstart(props: Numbered) {
  return (
    <Section
      {...props}
      title={<>Three steps, <span className="emphasis">then check it&apos;s paid.</span></>}
      lede="A server call, a button, a webhook. Use your test keys, and nothing you do here moves real money."
    >
      <div className="grid gap-3">
        <h3 className="eyebrow text-ink-muted">Before you start</h3>
        <ul className="grid border-y border-hairline md:grid-cols-3">
          {NEEDS.map((need, i) => (
            <li key={need.label} className={`grid content-start gap-1 border-hairline py-4 max-md:border-t max-md:first:border-t-0 md:pr-5 ${i ? "md:border-l md:pl-5" : ""}`}>
              <span className="font-medium text-ink">{need.label}</span>
              <span className="text-sm text-ink-muted">{need.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <ol className="grid gap-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className={`${card} md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-x-8`}>
            <div className="grid content-start gap-3">
              <span className="flex items-center gap-3">
                <span className="text-[44px] leading-none font-medium tracking-[-0.05em] text-accent md:text-[56px]">{String(i + 1).padStart(2, "0")}</span>
                <WhereTag where={step.where} />
              </span>
              <h3 className="title">{step.title}</h3>
              <p className="text-sm text-ink-muted">{step.text}</p>
              <a href={step.more.href} className={`${textLink} inline-flex min-h-11 w-fit items-center text-sm`}>
                {step.more.label}
              </a>
            </div>
            <div className="grid min-w-0 content-start gap-3">
              {step.code && <MiniCode code={step.code} />}
              {i === 0 && <Snippet code={code.CURL} name="the curl requests" file="Or with curl" />}
              {!step.code && <CheckPaid />}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Step 04's three places to look, each a plain link (full loads: the dashboard runs under its own CSP). */
function CheckPaid() {
  const places = [
    { href: "#simulate", label: "Simulate a payment", text: "a test checkout for the demo shop, to see one first" },
    { href: "/merchant/payments", label: "Payments", text: "the payment, its amount and its receipt" },
    { href: "/merchant/developers", label: "Developers", text: "the payment.succeeded delivery and its status" },
  ];
  return (
    <ol className="grid rounded-[14px] border border-hairline">
      {places.map((p, i) => (
        <li key={p.href} className="flex gap-3 border-t border-hairline px-4 py-3 text-sm first:border-t-0">
          <span className="eyebrow pt-0.5 text-accent">{String.fromCharCode(97 + i)}</span>
          <span className="min-w-0">
            <a href={p.href} className={textLink}>
              {p.label}
            </a>
            <span className="text-ink-muted">: {p.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
