// Server-only payment pages (SRS FR-GW-2, table app_gw_pages): fixed items or an open amount, checked out through the
// helpers in links.ts. The payer picks items and quantities; prices only ever come from the stored page.
import { getAddress, type Address } from "viem";
import type { LineItem } from "../sessions.ts";
import { paidCounts } from "./checkouts.ts";
import { query } from "./db.ts";
import { HttpError, currencyField, httpsUrl, merchantName, merchantVerified, newId, newSlug, textField, type Currency } from "./http.ts";
import { MAX_LIST, decimal, given, iso, limitCheckouts, openCheckout, payablePrices, priceField, readCheckoutBody } from "./links.ts";
import { dispatchSoon } from "./webhooks.ts";

const MAX_ITEMS = 20;
const MAX_QTY = 100;

interface PageItem {
  name: string;
  price: bigint; // in the page's currency, 6 decimals
}
export interface Page {
  id: string;
  slug: string;
  merchant: string; // lowercase address
  title: string;
  description: string | null;
  logoUrl: string | null;
  color: string | null;
  currency: Currency;
  items: PageItem[] | null; // null: an open-amount page
  openMin: bigint | null;
  openMax: bigint | null;
  createdAt: number;
  payments: number; // paid checkouts
}

type PageRow = { id: string; slug: string; merchant: string; title: string; description: string | null; logo_url: string | null; color: string | null; currency: Currency; items: string | null; open_min: string | null; open_max: string | null; created_at: string };
const COLUMNS = "id, slug, merchant, title, description, logo_url, color, currency, items, open_min::text, open_max::text, created_at::text";
const big = (text: string | null) => (text === null ? null : BigInt(text));

async function withPayments(rows: PageRow[]): Promise<Page[]> {
  const paid = await paidCounts("page", rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    merchant: r.merchant,
    title: r.title,
    description: r.description,
    logoUrl: r.logo_url,
    color: r.color,
    currency: r.currency,
    items: r.items === null ? null : (JSON.parse(r.items) as { name: string; price: string }[]).map((i) => ({ name: i.name, price: BigInt(i.price) })),
    openMin: big(r.open_min),
    openMax: big(r.open_max),
    createdAt: Number(r.created_at),
    payments: paid.get(r.id) ?? 0,
  }));
}

const render = (page: Page) => ({
  title: page.title,
  description: page.description,
  logo_url: page.logoUrl,
  color: page.color,
  currency: page.currency,
  items: page.items?.map((i) => ({ name: i.name, price: decimal(i.price) })) ?? null,
  open_amount: page.items ? null : { min: decimal(page.openMin), max: decimal(page.openMax) },
});

/** The dashboard's view of a page. */
export const pageJson = (page: Page) => ({ id: page.id, slug: page.slug, url: `/p/${page.slug}`, ...render(page), created_at: iso(page.createdAt), payments: page.payments });

/** What a payer sees: render info only, nothing merchant-private. */
export const publicPageJson = (page: Page) => ({ slug: page.slug, ...render(page), merchant_name: merchantName(getAddress(page.merchant)), merchant_verified: merchantVerified(page.merchant) });

function itemsField(value: unknown): PageItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) throw new HttpError(400, `items must be a list of 1 to ${MAX_ITEMS} {name, price}.`);
  const items = value.map((raw: { name?: unknown; price?: unknown } | null, i) => {
    const name = textField(raw?.name, `items[${i}].name`, { max: 80 });
    if (!name) throw new HttpError(400, `items[${i}].name is required.`);
    return { name, price: priceField(raw?.price, `items[${i}].price`) };
  });
  if (new Set(items.map((i) => i.name)).size !== items.length) throw new HttpError(400, "Item names must be unique.");
  return items;
}

function openAmountField(value: unknown): { min: bigint | null; max: bigint | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "open_amount must be {min?, max?}.");
  const { min, max } = value as Record<string, unknown>;
  const bounds = { min: given(min) ? priceField(min, "open_amount.min") : null, max: given(max) ? priceField(max, "open_amount.max") : null };
  if (bounds.min !== null && bounds.max !== null && bounds.min > bounds.max) throw new HttpError(400, "open_amount.min must not be above open_amount.max.");
  return bounds;
}

export async function createPage(merchant: Address, body: Record<string, unknown>, now = Date.now()): Promise<Page> {
  const title = textField(body.title, "title", { max: 80 });
  const description = textField(body.description, "description", { max: 500, required: false }) || null;
  const logoUrl = given(body.logo_url) && body.logo_url !== "" ? httpsUrl(body.logo_url, "logo_url") : null;
  if (given(body.color) && !(typeof body.color === "string" && /^#[0-9a-fA-F]{6}$/.test(body.color))) throw new HttpError(400, "color must look like #1A2B3C.");
  const color = given(body.color) ? String(body.color).toUpperCase() : null;
  const currency = currencyField(body.currency);
  if (given(body.items) === given(body.open_amount)) throw new HttpError(400, "Send either items or open_amount.");
  const items = given(body.items) ? itemsField(body.items) : null;
  const open = items ? { min: null, max: null } : openAmountField(body.open_amount);
  // each item, or the open minimum, must be at most 1,000 USDT at today's rate (a cheap item adds up in a cart)
  await payablePrices(items ? items.map((i) => i.price) : open.min === null ? [] : [open.min], currency);
  const stored = items && JSON.stringify(items.map((i) => ({ name: i.name, price: i.price.toString() })));
  const rows = await query<PageRow>(
    `INSERT INTO app_gw_pages (id, slug, merchant, title, description, logo_url, color, currency, items, open_min, open_max, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${COLUMNS}`,
    [newId("page"), newSlug(), merchant.toLowerCase(), title, description, logoUrl, color, currency, stored, open.min?.toString() ?? null, open.max?.toString() ?? null, now],
  );
  return (await withPayments(rows))[0];
}

export async function listPages(merchant: Address): Promise<Page[]> {
  const rows = await query<PageRow>(`SELECT ${COLUMNS} FROM app_gw_pages WHERE merchant = $1 ORDER BY created_at DESC, id LIMIT ${MAX_LIST}`, [merchant.toLowerCase()]);
  return withPayments(rows);
}

export async function pageBySlug(slug: string): Promise<Page | null> {
  dispatchSoon(); // as linkBySlug: due webhook retries ride on checkout traffic
  const rows = await query<PageRow>(`SELECT ${COLUMNS} FROM app_gw_pages WHERE slug = $1`, [slug]);
  return rows.length ? (await withPayments(rows))[0] : null;
}

/** The payer's cart, priced from the page: each item at most once, qty 1..100. */
function pickItems(menu: PageItem[], value: unknown): LineItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ITEMS) throw new HttpError(400, `items must be a list of 1 to ${MAX_ITEMS} {name, qty}.`);
  const seen = new Set<string>();
  return value.map((raw: { name?: unknown; qty?: unknown } | null) => {
    const item = menu.find((m) => m.name === raw?.name);
    if (!item) throw new HttpError(400, "One of the items isn't on this page.");
    if (seen.has(item.name)) throw new HttpError(400, `"${item.name}" is in the cart twice.`);
    seen.add(item.name);
    const qty = raw?.qty;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new HttpError(400, `qty must be a whole number from 1 to ${MAX_QTY}.`);
    return { name: item.name, qty, price: item.price };
  });
}

function openAmount(page: Page, value: unknown): bigint {
  const amount = priceField(value, "amount");
  if (page.openMin !== null && amount < page.openMin) throw new HttpError(400, `amount must be at least ${decimal(page.openMin)} ${page.currency}.`);
  if (page.openMax !== null && amount > page.openMax) throw new HttpError(400, `amount must be at most ${decimal(page.openMax)} ${page.currency}.`);
  return amount;
}

/** A payer opens a checkout from a page: `{items: [{name, qty}]}` for an items page, `{amount}` for an open one. */
export async function payPage(request: Request, slug: string): Promise<Response> {
  await limitCheckouts(request);
  const page = await pageBySlug(slug);
  if (!page) throw new HttpError(404, "No such payment page.");
  const body = await readCheckoutBody(request);
  const picked = page.items ? pickItems(page.items, body.items) : [{ name: page.title, qty: 1, price: openAmount(page, body.amount) }];
  const from = { kind: "page" as const, refId: page.id, merchant: page.merchant, reference: page.slug };
  return openCheckout(request, from, picked, page.currency);
}
