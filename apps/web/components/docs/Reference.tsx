// The data-driven parts of /docs: the API reference, currencies, limits and errors, all rendered from
// lib/docs-reference.ts (held to the code by test/docs-reference.test.mjs). The FX bands are read from the quotes
// module itself, so the page can't drift from what the gateway accepts.
import { AUTH, ERRORS, FX_CURRENCIES, LIMITS, RATE_LIMITS, RESOURCES, type Auth } from "@/lib/docs-reference";
import { BANDS } from "@/lib/server/quotes";
import { AuthChip, Code, DocTable, MethodPill, Path, Rich, Snippet, card } from "./ui";

const ENDPOINT_COLUMNS = [
  { label: "Endpoint", width: "w-[31%]", stackLabel: false },
  { label: "Auth", width: "w-[15%]" },
  { label: "Body", width: "w-[27%]" },
  { label: "Reply", width: "w-[27%]" },
];

export function ApiReference() {
  return (
    <div className="grid gap-12">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(AUTH) as Auth[]).map((auth) => (
          <li key={auth} className={card}>
            <AuthChip auth={auth} />
            <p className="text-sm text-ink-muted">
              <Rich text={AUTH[auth].how} />
            </p>
          </li>
        ))}
      </ul>
      {RESOURCES.map((resource) => (
        <div key={resource.id} id={`api-${resource.id}`} className="grid min-w-0 scroll-mt-24 gap-4 md:scroll-mt-10">
          <div className="grid gap-1">
            <h3 className="title">{resource.title}</h3>
            <p className="max-w-[62ch] text-sm text-ink-muted">
              <Rich text={resource.about} />
            </p>
          </div>
          <DocTable
            caption={`${resource.title} endpoints`}
            columns={ENDPOINT_COLUMNS}
            rows={resource.endpoints.map((e) => ({
              key: `${e.method} ${e.path}`,
              cells: [
                <span key="endpoint" className="flex flex-wrap items-center gap-2">
                  <MethodPill method={e.method} />
                  <Path path={e.path} />
                </span>,
                <AuthChip key="auth" auth={e.auth} />,
                <span key="body" className="text-ink-muted">
                  <Rich text={e.body} />
                </span>,
                <span key="reply" className="text-ink-muted">
                  <Rich text={e.reply} />
                </span>,
              ],
            }))}
          />
        </div>
      ))}
    </div>
  );
}

const band = (code: string) => {
  const range = BANDS[code as keyof typeof BANDS];
  if (range) return `${range[0]} to ${range[1]}`;
  return code === "USD" ? "1" : "None: USDT is what the customer pays";
};

export function Currencies() {
  return (
    <DocTable
      caption="Price currencies"
      columns={[
        { label: "Currency", width: "w-[16%]" },
        { label: "Name", width: "w-[24%]" },
        { label: "Priced", width: "w-[24%]" },
        { label: "Rates we accept, per 1 USD", width: "w-[36%]" },
      ]}
      rows={FX_CURRENCIES.map((c) => ({
        key: c.code,
        cells: [
          <span key="code" className="data font-medium text-ink">
            {c.code}
          </span>,
          c.name,
          <span key="how" className="text-ink-muted">
            {c.how}
          </span>,
          <span key="band" className="data text-ink-muted">
            {band(c.code)}
          </span>,
        ],
      }))}
    />
  );
}

const LIMIT_ROWS: [string, string][] = [
  ["Per payment", `${LIMITS.minPaymentUsdt} to ${LIMITS.maxPaymentUsdt} USDT, after conversion. Checkouts, links and pages alike.`],
  ["Amounts", 'Decimal strings with up to 6 decimals, like "25.00". Never floats.'],
  ["Checkout lifetime", `${LIMITS.checkoutMinutes} minutes in USDT or USD. ${LIMITS.quoteLockMinutes} minutes in any other currency: the checkout ends with its quote.`],
  ["reference", `Up to ${LIMITS.referenceMax} characters, trimmed. The SDK's orderId: 1 to ${LIMITS.referenceMax} characters, no spaces at either end.`],
  ["returnUrl", `An http or https URL of up to ${LIMITS.returnUrlMax} characters, stored as the browser will read it.`],
  ["items", `Up to ${LIMITS.itemsMax} per checkout, qty 1 to ${LIMITS.itemQtyMax}, prices in the checkout's currency that add up to amount.`],
  [
    "Idempotency-Key",
    `1 to ${LIMITS.idempotencyKeyMax} characters. The same key with the same body within ${LIMITS.idempotencyHours} hours gets the first checkout back; another body gets 422. Only a created checkout is replayed, so a refused one frees the key.`,
  ],
  ["payments.list", `limit 1 to ${LIMITS.paymentsPageMax}, default 20.`],
  ["Keys and endpoints", `${LIMITS.keysMax} live API keys and ${LIMITS.webhookEndpointsMax} webhook endpoints per merchant.`],
  ["Dashboard lists", `Links and pages list the newest ${LIMITS.listMax}. A report covers up to ${LIMITS.reportDaysMax} days.`],
];

const perWindow = (ms: number) => (ms === 60_000 ? "a minute" : ms === 3_600_000 ? "an hour" : `per ${ms / 1000} s`);

export function Limits() {
  return (
    <div className="grid gap-8">
      <DocTable
        caption="Limits"
        columns={[
          { label: "What", width: "w-[24%]" },
          { label: "Limit", width: "w-[76%]" },
        ]}
        rows={LIMIT_ROWS.map(([what, limit]) => ({
          key: what,
          cells: [
            <span key="what" className="font-medium text-ink">
              {what}
            </span>,
            <span key="limit" className="text-ink-muted">
              {limit}
            </span>,
          ],
        }))}
      />
      <div className="grid gap-4">
        <h3 className="title">Rate limits</h3>
        <p className="max-w-[62ch] text-sm text-ink-muted">
          Over a limit you get <Code>429</Code> with a plain message; wait a minute and try again. On this test server each limit is counted per server
          instance.
        </p>
        <DocTable
          caption="Rate limits"
          columns={[
            { label: "Endpoint", width: "w-[46%]", stackLabel: false },
            { label: "Limit", width: "w-[22%]" },
            { label: "Counted per", width: "w-[32%]" },
          ]}
          rows={RATE_LIMITS.map((r) => ({
            key: r.endpoints.map((e) => `${e.method} ${e.path}`).join(","),
            cells: [
              <span key="endpoints" className="grid gap-2">
                {r.endpoints.map((e) => (
                  <span key={`${e.method} ${e.path}`} className="flex flex-wrap items-center gap-2">
                    <MethodPill method={e.method} />
                    <Path path={e.path} />
                  </span>
                ))}
              </span>,
              <span key="limit" className="font-medium text-ink">
                {r.limit} {perWindow(r.windowMs)}
              </span>,
              <span key="per" className="text-ink-muted">
                {r.per}
              </span>,
            ],
          }))}
        />
      </div>
    </div>
  );
}

const ERROR_BODY = `{ "error": "amount must look like 25.00 (up to 6 decimals)." }`;

export function Errors() {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <p className="text-ink-muted">
          Every error is JSON with one plain sentence in <Code>error</Code>, written so you can show it as is. The SDK throws a{" "}
          <Code>GatewayError</Code> with the same <Code>message</Code> and the HTTP <Code>status</Code> (0 when the gateway couldn&apos;t be reached), with
          your key replaced by <Code>[secret key]</Code>.
        </p>
        <Snippet code={ERROR_BODY} name="the error body" file="400 · application/json" />
      </div>
      <DocTable
        caption="Error status codes"
        columns={[
          { label: "Status", width: "w-[12%]" },
          { label: "Means", width: "w-[38%]" },
          { label: "What we say", width: "w-[50%]" },
        ]}
        rows={ERRORS.map((e) => ({
          key: String(e.status),
          cells: [
            <span key="status" className="data font-medium text-ink">
              {e.status}
            </span>,
            <span key="means" className="text-ink-muted">
              {e.meaning}
            </span>,
            <ul key="say" className="grid gap-1.5">
              {e.examples.map((example) => (
                <li key={example} className="text-ink">
                  &ldquo;{example}&rdquo;
                </li>
              ))}
            </ul>,
          ],
        }))}
      />
    </div>
  );
}
