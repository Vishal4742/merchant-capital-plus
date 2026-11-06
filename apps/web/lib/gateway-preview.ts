// Preview of the gateway screens before claude-contracts' backend is on main: with GATEWAY_PREVIEW=1 (never on Vercel)
// our server answers the links and pages reads from these fixtures, in the API's own shapes (API.md). Nothing here can
// be paid: every checkout answers 503. The tests use the same fixtures.
import { paymentsIn, rangeOf, report, usdt, type ChainPayment, type History } from "./server/reports.ts"; // batch 012
import { HttpError } from "./server/http.ts"; // batch 012
import { EXPLORER } from "./usdt.ts"; // batch 012

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 6, 3, 0); // a fixed clock, so screenshots don't drift
const at = (days: number) => new Date(T0 + days * DAY_MS).toISOString();

const link = (slug: string, fields: Record<string, unknown>) => ({
  id: `lnk_${slug}`,
  slug,
  url: `/l/${slug}`,
  amount: "25",
  currency: "USD",
  description: "Cold brew for the office",
  reference_id: null,
  single_use: false,
  status: "active",
  expires_at: null,
  created_at: at(-1),
  payments: 0,
  ...fields,
});

export const PREVIEW_LINKS = [
  link("CoLdBrEw01", { description: "Two cold brews, table 4", amount: "12.5", single_use: true, expires_at: at(2), reference_id: "T4-0611", created_at: at(0) }),
  link("TiPjAr0001", { description: "Tip the Bandra Beans team", amount: null, payments: 7, created_at: at(-0.5) }),
  link("CaTeRiNg01", { description: "Office catering, Friday", amount: "18000", currency: "INR", single_use: true, payments: 1, status: "paid", created_at: at(-2) }),
  link("BeAnS00002", { description: "1 kg house roast beans", amount: "21.5", currency: "EUR", payments: 3, created_at: at(-3) }),
  link("ExPiReD001", { description: "Weekend brunch deposit", amount: "40", expires_at: at(-1), status: "expired", created_at: at(-6) }),
  link("CaNcElEd01", { description: "Old espresso class", amount: "15", currency: "GBP", status: "cancelled", created_at: at(-9) }),
];

const MERCHANT_NAME = "Bandra Beans";

export const PREVIEW_PAGES = [
  {
    id: "page_BaNdRaMeNu",
    slug: "BaNdRaMeNu",
    url: "/p/BaNdRaMeNu",
    title: "Order ahead at Bandra Beans",
    description: "Pick up at the counter on Hill Road. Ready in about ten minutes.",
    logo_url: "https://bandrabeans.example/logo.png",
    color: "#B4532A",
    currency: "USD",
    items: [
      { name: "Cold brew", price: "5" },
      { name: "Banana bread", price: "3.5" },
      { name: "House roast, 250 g", price: "12" },
    ],
    open_amount: null,
    created_at: at(-1),
    payments: 12,
  },
  {
    id: "page_TiPpAgE001",
    slug: "TiPpAgE001",
    url: "/p/TiPpAgE001",
    title: "Support the night shift",
    description: "Every tip goes to the baristas on duty tonight.",
    logo_url: null,
    color: "#1723E2",
    currency: "EUR",
    items: null,
    open_amount: { min: "2", max: "50" },
    created_at: at(-4),
    payments: 5,
  },
];

const publicLink = (l: (typeof PREVIEW_LINKS)[number]) => ({ slug: l.slug, merchant_name: MERCHANT_NAME, amount: l.amount, currency: l.currency, description: l.description, status: l.status });
const publicPage = (p: (typeof PREVIEW_PAGES)[number]) => ({
  slug: p.slug,
  title: p.title,
  description: p.description,
  logo_url: p.logo_url,
  color: p.color,
  currency: p.currency,
  items: p.items,
  open_amount: p.open_amount,
  merchant_name: MERCHANT_NAME,
});

/** True only when GATEWAY_PREVIEW=1 and this isn't a Vercel deployment (VERCEL is set on every build and function). */
export const previewOn = (env: Record<string, string | undefined> = process.env) => env.GATEWAY_PREVIEW === "1" && !env.VERCEL && !env.VERCEL_ENV;

/** Answers the client's calls from the fixtures, as the gateway would. */
export const previewFetch: typeof fetch = async (input, init) => {
  const path = new URL(String(input), "http://preview.invalid").pathname;
  const reply = (body: unknown, status = 200) => Response.json(body, { status });
  if ((init?.method ?? "GET") !== "GET") return reply({ error: "This is a preview: nothing can be created or paid here." }, 503);
  const money = moneyPreview(String(input)); // batch 012
  if (money) return money;
  if (path === "/api/v1/links") return reply({ links: PREVIEW_LINKS });
  if (path === "/api/v1/pages") return reply({ pages: PREVIEW_PAGES });
  const [, kind, slug] = path.match(/^\/api\/v1\/public\/(links|pages)\/([^/]+)$/) ?? [];
  const found = kind === "links" ? PREVIEW_LINKS.find((l) => l.slug === slug) : PREVIEW_PAGES.find((p) => p.slug === slug);
  if (!found) return reply({ error: kind === "pages" ? "No such payment page." : "No such payment link." }, 404);
  return reply(kind === "links" ? publicLink(found as (typeof PREVIEW_LINKS)[number]) : publicPage(found as (typeof PREVIEW_PAGES)[number]));
};

// ── batch 012 (claude-frontend): vouchers, reports and settlements ──
// The report and its range rules are the gateway's own (lib/server/reports.ts) run over a fixed sales history, so the
// preview's shapes and its 400s are the real ones; settlement rows are mapped as lib/server/settlements.ts maps them.

const voucher = (code: string, fields: Record<string, unknown>) => ({
  id: `vch_${code}`,
  code,
  kind: "percent",
  value: "10",
  expires_at: at(24),
  max_redemptions: 100,
  times_redeemed: 0,
  min_amount: null,
  active: true,
  arkiv_entity_key: null,
  created_at: at(-1),
  ...fields,
});

export const PREVIEW_VOUCHERS = [
  voucher("FLAT5", { kind: "fixed", value: "5", min_amount: "20", max_redemptions: 50, times_redeemed: 12, expires_at: at(10), arkiv_entity_key: "0x4c65053b8a7b0dd5ab462ee6fb0d2e943267cf3bcdbe7340fcb2d06b068fc9cc", created_at: at(-3) }),
  voucher("SAVE10", { times_redeemed: 59, arkiv_entity_key: "0x0b5674c54b61fe65062dadcc70ffb94dcb83a6e6d379bed01e149f0870697c5c", created_at: at(-12) }),
  voucher("MONSOON25", { value: "25", max_redemptions: 20, times_redeemed: 20, arkiv_entity_key: "0xb88a0454bcd6c12d919bf651e04b2c9af18e60fd0dd929c02ef762ac8d05441b", created_at: at(-20) }),
  voucher("DIWALI15", { value: "15", max_redemptions: 200, times_redeemed: 34, expires_at: at(-2), created_at: at(-30) }),
  voucher("STAFF50", { value: "50", max_redemptions: 5, times_redeemed: 1, active: false, created_at: at(-40) }),
];

const PAYERS: `0x${string}`[] = [
  "0xff219fb7669580b3508e8232fa98f355d1b40d2f",
  "0xb5f0cc488b88a3f261f3095f3321ea334c068688",
  "0x7fab0e7c0d629a9e9d3bd0b36a1dda4c6fb32f74",
  "0x4d05ccc0695eb3ad88f7596c162cef15400ef776",
  "0x30d86b85e481eefc611422ad391d6939bbcbe259",
];
const SALES_PER_DAY = [4, 2, 5, 3, 0, 6, 3, 2, 4, 1, 5, 2, 3, 0, 4, 2, 3, 1, 2, 4, 3]; // today first
const PRICES = [5_000_000n, 12_500_000n, 3_500_000n, 21_500_000n, 8_000_000n, 18_000_000n];
const RELAY_FEE = 100_000n; // MerchantPay's 0.10 USDT
const MINUTE_MS = 60_000;

const PREVIEW_PAYMENTS: ChainPayment[] = SALES_PER_DAY.flatMap((n, daysAgo) => Array.from({ length: n }, (_, j) => ({ daysAgo, j })))
  .sort((a, b) => b.daysAgo - a.daysAgo || a.j - b.j)
  .map(({ daysAgo, j }, i) => {
    const gross = PRICES[(daysAgo + j) % PRICES.length];
    const toInvestors = daysAgo < 3 && j === 0 ? gross / 5n : 0n; // an advance is open: its investors take their share
    const txHash: `0x${string}` = `0x${(i + 1).toString(16).padStart(64, "0")}`;
    return { paymentId: BigInt(i + 1), payer: PAYERS[(daysAgo * 3 + j) % PAYERS.length], gross, fee: RELAY_FEE, toInvestors, toMerchant: gross - RELAY_FEE - toInvestors, refunded: 0n, txHash, time: T0 - daysAgo * DAY_MS + j * 47 * MINUTE_MS };
  });
const REFUNDED = PREVIEW_PAYMENTS[PREVIEW_PAYMENTS.length - 6];
const PREVIEW_HISTORY: History = {
  payments: PREVIEW_PAYMENTS.map((p) => (p === REFUNDED ? { ...p, refunded: 3_500_000n } : p)),
  refunds: [{ paymentId: REFUNDED.paymentId, amount: 3_500_000n, time: REFUNDED.time + 120 * MINUTE_MS }],
};

const settlementJson = (p: ChainPayment) => ({
  payment_id: p.paymentId.toString(),
  gross: usdt(p.gross),
  fee: usdt(p.fee),
  to_investors: usdt(p.toInvestors),
  net: usdt(p.toMerchant),
  tx_hash: p.txHash,
  settled_at: new Date(p.time).toISOString(),
  explorer_url: p.txHash ? `${EXPLORER}/tx/${p.txHash}` : null,
});

/** The vouchers, reports and settlements reads; null for any other path. */
function moneyPreview(input: string): Response | null {
  const url = new URL(input, "http://preview.invalid");
  const reply = (body: unknown, status = 200) => Response.json(body, { status });
  try {
    if (url.pathname === "/api/v1/vouchers") return reply({ vouchers: PREVIEW_VOUCHERS });
    if (url.pathname === "/api/v1/reports") return reply(report(PREVIEW_HISTORY, rangeOf(new Request(url), T0)));
    if (url.pathname === "/api/v1/settlements") return reply({ balance: "1284.35", settlements: [...paymentsIn(PREVIEW_HISTORY, rangeOf(new Request(url), T0))].reverse().map(settlementJson) });
  } catch (error) {
    if (error instanceof HttpError) return reply({ error: error.message }, error.status);
    throw error;
  }
  return null;
}
// ── end batch 012 ──
