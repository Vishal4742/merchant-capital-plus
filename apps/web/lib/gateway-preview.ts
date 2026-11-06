// Preview of the gateway screens before claude-contracts' backend is on main: with GATEWAY_PREVIEW=1 (never on Vercel)
// our server answers the links and pages reads from these fixtures, in the API's own shapes (API.md). Nothing here can
// be paid: every checkout answers 503. The tests use the same fixtures.

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
  if (path === "/api/v1/links") return reply({ links: PREVIEW_LINKS });
  if (path === "/api/v1/pages") return reply({ pages: PREVIEW_PAGES });
  const [, kind, slug] = path.match(/^\/api\/v1\/public\/(links|pages)\/([^/]+)$/) ?? [];
  const found = kind === "links" ? PREVIEW_LINKS.find((l) => l.slug === slug) : PREVIEW_PAGES.find((p) => p.slug === slug);
  if (!found) return reply({ error: kind === "pages" ? "No such payment page." : "No such payment link." }, 404);
  return reply(kind === "links" ? publicLink(found as (typeof PREVIEW_LINKS)[number]) : publicPage(found as (typeof PREVIEW_PAGES)[number]));
};
