// The data-driven parts of /docs: the API reference (grouped by who calls it, with full pages for the endpoints a
// shop's server calls), the checkout statuses, webhook events, currencies, limits, errors and test scenarios, all
// rendered from lib/docs-reference.ts (held to the code by test/docs-reference.test.mjs and docs-endpoints.test.mjs).
// The FX bands are read from the quotes module itself, so the page can't drift from what the gateway accepts.
// Server components only: the closed groups are native <details>, so they open with no script.
import {
  AUTH,
  CHECKOUT_STATUSES,
  ERRORS,
  EVENTS,
  FX_CURRENCIES,
  GROUPS,
  LIMITS,
  RATE_LIMITS,
  RESOURCES,
  TEST_SCENARIOS,
  type Auth,
  type Endpoint,
  type Group,
  type Resource,
} from "@/lib/docs-reference";
import { BANDS } from "@/lib/server/quotes";
import { curl } from "./snippets";
import { AuthChip, Callout, Code, DocTable, MethodPill, Path, Rich, Snippet, card } from "./ui";

const ENDPOINT_COLUMNS = [
  { label: "Endpoint", width: "w-[31%]", stackLabel: false },
  { label: "Auth", width: "w-[15%]" },
  { label: "Body", width: "w-[27%]" },
  { label: "Reply", width: "w-[27%]" },
];

/** The nav's sub-anchors for the reference: the open group's resources, then the closed groups. */
export const API_ANCHORS = [
  ...RESOURCES.filter((r) => r.group === "server").map((r) => ({ id: `api-${r.id}`, label: r.title })),
  { id: "api-dashboard", label: GROUPS.dashboard.title },
  { id: "api-hosted-pages", label: GROUPS.hosted.title },
];

const inGroup = (group: Group) => RESOURCES.filter((r) => r.group === group);
const endpointCount = (group: Group) => inGroup(group).reduce((n, r) => n + r.endpoints.length, 0);

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
      <Callout>
        Amounts are decimal strings, like <Code>&quot;25.00&quot;</Code>, in what you send and what you get back. Never send a float, and compare amounts
        with the SDK&apos;s <Code>sameAmount</Code>, not <Code>===</Code>.
      </Callout>
      <section id="api-server" aria-labelledby="api-server-title" className="grid min-w-0 scroll-mt-24 gap-12 md:scroll-mt-10">
        <div className="grid gap-1 border-t border-hairline pt-4">
          <h3 id="api-server-title" className="text-[26px] leading-tight font-medium tracking-[-0.03em]">
            {GROUPS.server.title}
          </h3>
          <p className="text-sm text-ink-muted">{GROUPS.server.about}</p>
        </div>
        {inGroup("server").map((resource) => (
          <ResourceBlock key={resource.id} resource={resource} />
        ))}
      </section>
      {(["dashboard", "hosted"] as const).map((group) => (
        <details key={group} id={group === "hosted" ? "api-hosted-pages" : "api-dashboard"} className="group min-w-0 scroll-mt-24 md:scroll-mt-10">
          {/* a heading may sit straight in <summary>; a grid places the count beside it with no wrapper */}
          <summary className="lift grid min-h-14 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-[20px] border border-hairline bg-surface px-5 py-4 hover:border-accent md:px-6 [&::-webkit-details-marker]:hidden">
            <h3 className="title col-start-1">{GROUPS[group].title}</h3>
            <span className="eyebrow col-start-2 row-span-2 row-start-1 flex items-center gap-2 text-accent">
              <span className="max-sm:sr-only">{endpointCount(group)} endpoints</span>
              <span aria-hidden className="inline-block text-base leading-none transition-transform group-open:rotate-45">
                +
              </span>
            </span>
            <span className="col-start-1 text-sm text-ink-muted">{GROUPS[group].about}</span>
          </summary>
          <div className="mt-10 grid gap-12">
            {inGroup(group).map((resource) => (
              <ResourceBlock key={resource.id} resource={resource} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

/** A resource: a full page for each endpoint that has one, a summary table row for the rest. */
function ResourceBlock({ resource }: { resource: Resource }) {
  const rows = resource.endpoints.filter((e) => !e.detail);
  return (
    <div id={`api-${resource.id}`} className="grid min-w-0 scroll-mt-24 gap-6 md:scroll-mt-10">
      <div className="grid gap-1">
        <h4 className="title">{resource.title}</h4>
        <p className="max-w-[62ch] text-sm text-ink-muted">
          <Rich text={resource.about} />
        </p>
      </div>
      {resource.endpoints.filter((e) => e.detail).map((e) => (
        <EndpointPage key={`${e.method} ${e.path}`} endpoint={e} />
      ))}
      {resource.id === "checkouts" && <Lifecycle />}
      {rows.length > 0 && (
        <DocTable
          caption={`${resource.title} endpoints`}
          columns={ENDPOINT_COLUMNS}
          rows={rows.map((e) => ({
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
      )}
    </div>
  );
}

const IN_LABEL = { body: "Body", header: "Header", path: "Path", query: "Query" } as const;

/** One endpoint in full: what it returns, its parameters, and an example request and response. */
function EndpointPage({ endpoint: e }: { endpoint: Endpoint }) {
  const detail = e.detail!;
  const name = `${e.method} ${e.path}`;
  return (
    <article aria-label={name} className="grid min-w-0 gap-4 rounded-[20px] border border-hairline p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <MethodPill method={e.method} />
        <h5 className="text-[17px] leading-6 font-medium">
          <Path path={e.path} />
        </h5>
        <AuthChip auth={e.auth} />
      </div>
      <p className="max-w-[70ch] text-sm text-ink-muted">
        <span className="font-medium text-ink">Returns </span>
        <Rich text={e.reply} />
      </p>
      <DocTable
        caption={`${name} parameters`}
        columns={[
          { label: "Name", width: "w-[24%]", stackLabel: false },
          { label: "Type", width: "w-[13%]", phoneHidden: true },
          { label: "Required", width: "w-[13%]", phoneHidden: true },
          { label: "Description", width: "w-[50%]" },
        ]}
        rows={detail.params.map((p) => ({
          key: p.name,
          cells: [
            <span key="name" className="grid gap-0.5">
              <code className="data font-medium break-all text-ink">{p.name}</code>
              <span className="eyebrow text-ink-muted">
                {IN_LABEL[p.in]}
                {/* a phone's card has no Type or Required cell: they ride on this line */}
                <span className="md:hidden">
                  {" · "}
                  {p.type} · <span className={p.required ? "text-ink" : undefined}>{p.required ? "Required" : "Optional"}</span>
                </span>
              </span>
            </span>,
            <span key="type" className="data text-ink-muted">
              {p.type}
            </span>,
            <span key="required" className={p.required ? "font-medium text-ink" : "text-ink-muted"}>
              {p.required ? "Required" : "Optional"}
            </span>,
            <span key="about" className="text-ink-muted">
              <Rich text={p.about} />
            </span>,
          ],
        }))}
      />
      {/* stacked, not side by side: the responses have lines too long for half the column */}
      <Snippet code={curl(e)} name={`the ${name} example request`} file="Example request · curl" />
      <Snippet code={JSON.stringify(detail.response, null, 2)} name={`the ${name} example response`} file={`Example response · ${detail.status}`} />
    </article>
  );
}

/** A checkout's statuses in the order they move, and which one to fulfil on. */
function Lifecycle() {
  return (
    <div className="grid min-w-0 gap-4">
      <h5 className="title">How a checkout&apos;s status moves</h5>
      <ol className="grid gap-0 sm:grid-cols-4" aria-label="Checkout statuses">
        {CHECKOUT_STATUSES.map((s, i) => (
          <li key={s.status} className="relative grid content-start gap-1 border-hairline py-3 max-sm:border-l max-sm:pl-4 sm:border-t sm:pt-4 sm:pr-4">
            <span
              aria-hidden
              className={`absolute size-2.5 rounded-full max-sm:top-4 max-sm:-left-[5.5px] sm:-top-[5.5px] sm:left-0 ${s.status === "paid" ? "bg-positive" : s.status === "expired" ? "bg-ink-muted" : "bg-accent"}`}
            />
            <span className="data font-medium text-ink">
              {s.status}
              {i === CHECKOUT_STATUSES.length - 1 && <span className="font-normal text-ink-muted"> (from open)</span>}
            </span>
            <span className="text-sm text-ink-muted">{s.means}</span>
          </li>
        ))}
      </ol>
      <p className="text-sm text-ink-muted">open → pending → paid, or open → expired when nobody pays.</p>
      <Callout tone="warning">
        The customer&apos;s browser coming back to your <Code>returnUrl</Code> isn&apos;t proof of payment. Fulfil on payment.succeeded, or when the
        checkout reads <Code>paid</Code> and the amount is yours.
      </Callout>
    </div>
  );
}

/** The events we send, and when. */
export function Events() {
  const later = EVENTS.filter((e) => !e.sent);
  return (
    <div className="grid gap-3">
      <DocTable
        caption="Webhook events"
        columns={[
          { label: "Event", width: "w-[26%]" },
          { label: "When", width: "w-[44%]" },
          { label: "Extra data fields", width: "w-[30%]" },
        ]}
        rows={EVENTS.filter((e) => e.sent).map((e) => ({
          key: e.type,
          cells: [
            <code key="type" className="data font-medium text-ink">
              {e.type}
            </code>,
            <span key="when" className="text-ink-muted">
              {e.when}
            </span>,
            <span key="extra" className="text-ink-muted">
              <Rich text={e.extra} />
            </span>,
          ],
        }))}
      />
      {later.map((e) => (
        <p key={e.type} className="text-sm text-ink-muted">
          <Code>{e.type}</Code> isn&apos;t sent yet. Read <Code>refunded</Code> from <Code>GET /api/v1/sessions/{"{id}"}</Code> or{" "}
          <Code>GET /api/v1/payments</Code> instead.
        </p>
      ))}
    </div>
  );
}

/** How to make each outcome happen in test mode, and what you get back. */
export function TestScenarios() {
  return (
    <DocTable
      caption="Test scenarios"
      columns={[
        { label: "Scenario", width: "w-[18%]" },
        { label: "How to trigger it", width: "w-[38%]" },
        { label: "What you get", width: "w-[44%]" },
      ]}
      rows={TEST_SCENARIOS.map((t) => ({
        key: t.id,
        cells: [
          <span key="scenario" className="font-medium text-ink">
            {t.scenario}
          </span>,
          <span key="how" className="text-ink-muted">
            <Rich text={t.how} />
          </span>,
          <span key="result" className="grid gap-1.5">
            {t.status && (
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="data font-medium text-ink">{t.status}</span>
                {t.messages?.map((m) => (
                  <span key={m} className="text-ink">
                    &ldquo;{m}&rdquo;
                  </span>
                ))}
              </span>
            )}
            <span className="text-ink-muted">
              <Rich text={t.result} />
            </span>
          </span>,
        ],
      }))}
    />
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
          { label: "Status", width: "w-[9%]" },
          { label: "Means", width: "w-[27%]" },
          { label: "What we say", width: "w-[34%]" },
          { label: "What to do", width: "w-[30%]" },
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
            <span key="fix" className="text-ink-muted">
              <Rich text={e.fix} />
            </span>,
          ],
        }))}
      />
    </div>
  );
}
