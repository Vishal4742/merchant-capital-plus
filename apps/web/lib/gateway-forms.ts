// The gateway's forms, checked before anything is sent (FR-GW-1, FR-GW-2): the dashboard's new link and new page, and
// the hosted /l and /p pages' plain form posts. Pure, so the browser and our server run the same rules. The gateway
// checks everything again; these only save a round trip and give the plain message.
import { PRICE_CURRENCIES, type CheckoutBody, type Currency, type LinkBody, type LinkStatus, type PageBody, type PageItem } from "./gateway-client.ts";
import { formatUsdt, parseUsdt } from "./usdt.ts";

export type Checked<T, E = string> = { ok: true; value: T } | { ok: false; error: E };
const ok = <T>(value: T) => ({ ok: true, value }) as const;
const no = <E>(error: E) => ({ ok: false, error }) as const;

const USD_MIN = 1_000_000n; // MerchantPay's minimum payment, 1 USDT (6 decimals)
const USD_MAX = 1_000_000_000n; // the testnet cap per payment, 1,000 USDT (ARCHITECTURE §4b)
const MAX_PRICE = 100_000_000_000_000n; // the gateway's sanity cap on a price in any currency
const MAX_FUTURE_MS = 5 * 365 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 20;
export const MAX_QTY = 100;
/** A hosted page's quantity fields are named `qty:<item name>`. */
export const QTY = "qty:";
const AMOUNT = /^\d{1,15}(\.\d{1,6})?$/;

/** "25.00" → 6-decimal units, or null unless it is a positive decimal with at most 6 places. */
function units(text: string): bigint | null {
  try {
    const value = parseUsdt(text);
    return value > 0n && value <= MAX_PRICE ? value : null;
  } catch {
    return null;
  }
}

/** A decimal ("12.5") as the screens show it ("12.50", "18,000.00"); text that isn't one (a price being typed in the
 *  live preview) is shown as typed. */
export function amountText(amount: string): string {
  try {
    return formatUsdt(parseUsdt(amount));
  } catch {
    return amount;
  }
}

const isCurrency = (c: string): c is Exclude<Currency, "USDT"> => (PRICE_CURRENCIES as readonly string[]).includes(c);

function isHttps(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export interface LinkForm {
  amount: string;
  open: boolean; // the customer chooses the amount
  currency: string;
  description: string;
  expires: string; // a datetime-local value, or ""
  reusable: boolean;
}

export function linkBody(f: LinkForm, now = Date.now()): Checked<LinkBody> {
  if (!isCurrency(f.currency)) return no("Choose a currency from the list.");
  const amount = f.open ? null : units(f.amount);
  if (!f.open && amount === null) return no("Enter an amount like 25.00, or let the customer choose it.");
  if (f.currency === "USD" && amount !== null && (amount < USD_MIN || amount > USD_MAX)) return no("Enter an amount from 1.00 to 1,000.00 USD.");
  const description = f.description.trim();
  if (!description) return no('Say what the link is for, like "Cold brew for the office".');
  if (description.length > 200) return no("Keep the description to 200 characters.");
  const body: LinkBody = { amount: f.open ? null : f.amount.trim(), currency: f.currency, description, single_use: !f.reusable };
  if (!f.expires.trim()) return ok(body);
  const ms = Date.parse(f.expires);
  if (!(ms > now)) return no("Pick an expiry in the future, or leave it empty.");
  if (ms > now + MAX_FUTURE_MS) return no("Pick an expiry within 5 years.");
  return ok({ ...body, expires_at: new Date(ms).toISOString() });
}

export interface PageForm {
  title: string;
  description: string;
  logoUrl: string;
  color: string;
  currency: string;
  mode: "items" | "open";
  items: PageItem[];
  min: string;
  max: string;
}

function itemsProblem(items: PageItem[]): string | null {
  if (items.length < 1) return "Add at least one item, or let the customer choose the amount.";
  if (items.length > MAX_ITEMS) return `A page can have up to ${MAX_ITEMS} items.`;
  const names = items.map((item) => item.name.trim());
  for (const [i, name] of names.entries()) {
    if (!name) return `Give item ${i + 1} a name.`;
    if (name.length > 80) return `Keep item ${i + 1}'s name to 80 characters.`;
    if (names.indexOf(name) !== i) return `"${name}" is on the page twice. Give each item its own name.`;
    if (units(items[i].price) === null) return `Enter a price like 5.00 for ${name}.`;
  }
  return null;
}

export function pageBody(f: PageForm): Checked<PageBody> {
  const title = f.title.trim(), description = f.description.trim(), logo = f.logoUrl.trim();
  if (!title) return no("Give the page a title.");
  if (title.length > 80) return no("Keep the title to 80 characters.");
  if (description.length > 500) return no("Keep the description to 500 characters.");
  if (logo && !isHttps(logo)) return no("The logo must be a full https:// link to an image.");
  if (!/^#[0-9a-fA-F]{6}$/.test(f.color)) return no("Pick a colour for the page.");
  if (!isCurrency(f.currency)) return no("Choose a currency from the list.");
  const base = { title, ...(description ? { description } : {}), ...(logo ? { logo_url: logo } : {}), color: f.color.toUpperCase(), currency: f.currency };
  if (f.mode === "items") {
    const problem = itemsProblem(f.items);
    return problem ? no(problem) : ok({ ...base, items: f.items.map((item) => ({ name: item.name.trim(), price: item.price.trim() })) });
  }
  const min = f.min.trim(), max = f.max.trim();
  const lo = min ? units(min) : null, hi = max ? units(max) : null;
  if ((min && lo === null) || (max && hi === null)) return no("Enter each limit as an amount like 5.00, or leave it empty.");
  if (lo !== null && hi !== null && lo > hi) return no("The lowest amount can't be above the highest.");
  return ok({ ...base, open_amount: { ...(min ? { min } : {}), ...(max ? { max } : {}) } });
}

// ── the hosted pages ──

/** Fixed messages for a checkout that didn't open: the page shows one of these by its code, never the gateway's text. */
export const CHECKOUT_ERRORS = {
  amount: "That amount can't be paid here. Enter a number like 25.00 within the limits shown.",
  items: "Choose at least one item, up to 100 of each.",
  closed: "This can't be paid any more. Ask the shop for a new link.",
  busy: "Lots of people are paying right now. Wait a minute and try again.",
  down: "We couldn't open the payment just now. Nothing was charged. Try again in a minute.",
} as const;
export type CheckoutError = keyof typeof CHECKOUT_ERRORS;

/** The message for a `?error=` code, or null for anything else (the query is never echoed). */
export const checkoutMessage = (code: unknown) => (typeof code === "string" && Object.hasOwn(CHECKOUT_ERRORS, code) ? CHECKOUT_ERRORS[code as CheckoutError] : null);

/** What went wrong, by the gateway's status. `sent` is what the customer chose: a fixed link's 400 they can't fix. */
export function checkoutErrorCode(status: number, sent: "amount" | "items" | "fixed"): CheckoutError {
  if (status === 400) return sent === "fixed" ? "closed" : sent;
  if (status === 404 || status === 410) return "closed";
  if (status === 429) return "busy";
  return "down";
}

/** The customer's typed amount, trimmed, if it is a plain decimal. */
export const amountBody = (text: string): Checked<{ amount: string }, CheckoutError> => (AMOUNT.test(text.trim()) ? ok({ amount: text.trim() }) : no("amount"));

const qtyOf = (text: string | null) => (text !== null && /^\d{1,3}$/.test(text.trim()) && Number(text) <= MAX_QTY ? Number(text) : null);

/** A /p form post: {amount}, or the items with a quantity above 0 (names only: prices come from the stored page). */
export function pageCheckoutBody(form: URLSearchParams): Checked<CheckoutBody, CheckoutError> {
  const amount = form.get("amount");
  if (amount !== null) return amountBody(amount);
  const chosen = [...form].filter(([key]) => key.startsWith(QTY)).map(([key, value]) => ({ name: key.slice(QTY.length), qty: qtyOf(value) }));
  if (chosen.some((item) => item.qty === null)) return no("items");
  const items = chosen.flatMap((item) => (item.qty ? [{ name: item.name, qty: item.qty }] : []));
  return items.length > 0 && items.length <= MAX_ITEMS ? ok({ items }) : no("items");
}

/** Each item with the quantity in the query (`?qty:<name>=2`); a missing or bad one shows as 0. */
export const pageQuantities = (params: URLSearchParams, items: PageItem[]) => items.map((item) => ({ ...item, qty: qtyOf(params.get(QTY + item.name)) ?? 0 }));

/** The total of the chosen items, worked out on our server ("10.00"). */
export const pageTotal = (chosen: { price: string; qty: number }[]) => formatUsdt(chosen.reduce((sum, item) => sum + parseUsdt(item.price) * BigInt(item.qty), 0n));

/** What a customer sees on a link that can't be paid. */
export function closedLinkCopy(status: Exclude<LinkStatus, "active">, merchant: string) {
  const copy = {
    paid: { title: "This link has been paid", body: `It could be paid once, and it was. If you still need to pay, ask ${merchant} for a new link.` },
    expired: { title: "This link has expired", body: `Nothing was charged. Ask ${merchant} for a new link.` },
    cancelled: { title: "This link was turned off", body: `${merchant} cancelled it, so nothing can be paid here. Ask them for a new link.` },
  };
  return copy[status];
}

const MAX_PAGE_QTY = 100; // the page form's own limit; the server refuses more

/** A payment page's order total in 6-decimal units, as the customer types quantities (G4 UX review M1). A blank,
 *  fractional, negative or over-limit quantity counts as 0 here; the server is the one that refuses it. */
export function liveTotal(prices: readonly string[], quantities: readonly string[]): bigint {
  return prices.reduce((sum, price, i) => {
    const qty = Number(quantities[i]);
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_PAGE_QTY) return sum;
    try {
      return sum + parseUsdt(price) * BigInt(qty);
    } catch {
      return sum;
    }
  }, 0n);
}

