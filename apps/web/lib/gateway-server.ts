// Our server's side of the gateway screens: the hosted pages, the counter view and the dashboard read the gateway's
// own modules (lib/server) directly, never over HTTP to ourselves (code review G4 M4: one hop less, and the checkout
// limit sees each payer instead of our server). Server only; the browser's calls stay in lib/gateway-client.ts.
import type { Address } from "viem";
import { linkOf, pageOf, publicPageOf, type CheckoutBody } from "./gateway-client.ts";
import { checkoutErrorCode, type CheckoutError } from "./gateway-forms.ts";
import { rangeQuery, type ReportRange } from "./gateway-money.ts";
import { DbUnavailable } from "./server/db.ts";
import { HttpError } from "./server/http.ts";
import { linkBySlug, linkJson, listLinks, payLink, publicLinkJson } from "./server/links.ts";
import { listPages, pageBySlug, pageJson, payPage, publicPageJson } from "./server/pages.ts";
import { merchantHistory, merchantPayAddress, rangeOf, report } from "./server/reports.ts";
import { settlements } from "./server/settlements.ts";
import { listVouchers, voucherJson } from "./server/vouchers.ts";

const MAX_FORM_BYTES = 16_384;

/** This deployment's origin as the caller reached it (Vercel sets the host and x-forwarded-proto): for URLs we show
 *  (QR codes, copy links), through publicOrigin() so PUBLIC_ORIGIN wins. Never where the server sends a request. */
export function originOf(h: Headers): string {
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ? "https" : "http";
  return `${proto}://${h.get("host") ?? "localhost"}`;
}

// ── reads ──
// linkJson and pageJson type times and prices as nullable (their helpers also take null); the browser's own parsers
// narrow them, as they do a create's answer, so the screens keep the types they had.

/** What a payer sees of a link, or null when there is no such link. */
export const publicLink = async (slug: string) => {
  const link = await linkBySlug(slug);
  return link && publicLinkJson(link);
};
/** What a payer sees of a page, or null when there is no such page. */
export const publicPage = async (slug: string) => {
  const page = await pageBySlug(slug);
  return page && publicPageOf(publicPageJson(page));
};
export const merchantLinks = async (merchant: Address) => (await listLinks(merchant)).map((link) => linkOf(linkJson(link)));
export const merchantPages = async (merchant: Address) => (await listPages(merchant)).map((page) => pageOf(pageJson(page)));
export const merchantVouchers = async (merchant: Address) => (await listVouchers(merchant)).map(voucherJson);

/** The gateway's own range for days the screen has checked (reportRange): India days, as the API reads ?tz=. */
const rangeFor = (range: ReportRange) => rangeOf(new Request(`http://range.invalid/?${rangeQuery(range)}`));
export const merchantReport = async (merchant: Address, range: ReportRange) => report(await merchantHistory(merchantPayAddress(), merchant), rangeFor(range));
export const merchantSettlements = async (merchant: Address, range: ReportRange) => settlements(merchantPayAddress(), merchant, rangeFor(range));

/** Logs a failed read by the error's name only: its message can hold SQL or URLs (NFR-8). */
export const logFailure = (what: string, error: unknown) => console.error(`${what} failed:`, error instanceof Error ? error.name : typeof error);

/** One plain sentence for a failed dashboard read: the gateway's own (its HttpErrors are written for people), else ours. */
export function readFailure(what: string, error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof DbUnavailable) return `${what} aren't available on this server yet.`;
  logFailure(`reading ${what.toLowerCase()}`, error);
  return `We couldn't read your ${what.toLowerCase()} right now. Try again in a minute.`;
}

// ── the hosted pages' form posts ──

/** 303 to a path on this site (relative, so the customer stays on the origin they came from). */
export const seeOther = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/** A hosted page's plain form post (application/x-www-form-urlencoded); an oversized one reads as empty. */
export async function readForm(request: Request): Promise<URLSearchParams> {
  const text = await request.text();
  return new URLSearchParams(text.length > MAX_FORM_BYTES ? "" : text);
}

/** Opens a checkout from a hosted page's form: 303 to /checkout/{id}, or to `back(code)` with a fixed message code.
 *  The gateway's payLink/payPage get the payer's address, so their checkout limit (20 a minute per IP, the public
 *  routes' own) counts this payer; calling the limiter here as well would count each checkout twice. */
export async function openCheckout(
  request: Request,
  target: { kind: "links" | "pages"; slug: string; sent: "amount" | "items" | "fixed" },
  body: CheckoutBody,
  back: (code: CheckoutError) => string,
): Promise<Response> {
  const ask = new Request(request.url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "x-forwarded-for": request.headers.get("x-forwarded-for") ?? "" },
    body: JSON.stringify(body),
  });
  try {
    const opened = await (target.kind === "links" ? payLink : payPage)(ask, target.slug);
    const { session_id: id } = (await opened.json()) as { session_id: string };
    return seeOther(`/checkout/${id}`);
  } catch (error) {
    if (!(error instanceof HttpError)) logFailure("hosted checkout", error);
    return seeOther(back(checkoutErrorCode(error instanceof HttpError ? error.status : 0, target.sent)));
  }
}
