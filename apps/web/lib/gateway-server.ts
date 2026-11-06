// Our server's side of the gateway client: the hosted pages, the counter view and the dashboard read the gateway's
// routes on this same deployment, passing on the caller's sign-in cookie and address. Server only.
// ponytail: an HTTP call to ourselves while claude-contracts' backend lives on its own branch. Once it is on main, call
// lib/server/{links,pages}.ts directly: one hop less, and on Vercel (which rewrites x-forwarded-for on our own call)
// the public routes' per-IP rate limit then sees each payer instead of our server.
import { GatewayError, gatewayClient, type CheckoutBody, type Transport } from "./gateway-client.ts";
import { checkoutErrorCode, type CheckoutError } from "./gateway-forms.ts";
import { previewFetch, previewOn } from "./gateway-preview.ts";

const FORWARD = ["cookie", "x-forwarded-for"];
const MAX_FORM_BYTES = 16_384;

/** This deployment's origin as the caller reached it (Vercel sets the host and x-forwarded-proto): for URLs we show,
 *  through publicOrigin() so PUBLIC_ORIGIN wins; never for where the server sends a request (selfOrigin). */
export function originOf(h: Headers): string {
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() === "https" ? "https" : "http";
  return `${proto}://${h.get("host") ?? "localhost"}`;
}

/** Where our server calls its own gateway routes. Never the request's Host: a forged one pointed the call (with the
 *  caller's cookie) at any address (security review 010 F1). `next start` sets PORT; Vercel sets VERCEL_URL.
 *  ponytail: still an HTTP hop; calling lib/server/* directly removes it and the shared rate-limit bucket (010 F2). */
export function selfOrigin(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return `http://127.0.0.1:${env.PORT ?? "3000"}`;
}

/** How our server calls the gateway for one incoming request (the preview fixtures when GATEWAY_PREVIEW=1 off Vercel). */
export function transportFor(h: Headers): Transport {
  const base = selfOrigin();
  if (previewOn()) return { base, fetch: previewFetch };
  const headers = Object.fromEntries(FORWARD.flatMap((name) => (h.get(name) ? [[name, h.get(name) as string]] : [])));
  return { base, headers };
}

/** The gateway client for one incoming request. */
export const gatewayFor = (h: Headers) => gatewayClient(transportFor(h));

/** 303 to a path on this site (relative, so the customer stays on the origin they came from). */
export const seeOther = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/** A hosted page's plain form post (application/x-www-form-urlencoded); an oversized one reads as empty. */
export async function readForm(request: Request): Promise<URLSearchParams> {
  const text = await request.text();
  return new URLSearchParams(text.length > MAX_FORM_BYTES ? "" : text);
}

/** Opens a checkout from a hosted page's form: 303 to /checkout/{id}, or to `back(code)` with a fixed message code. */
export async function openCheckout(
  request: Request,
  target: { kind: "links" | "pages"; slug: string; sent: "amount" | "items" | "fixed" },
  body: CheckoutBody,
  back: (code: CheckoutError) => string,
): Promise<Response> {
  try {
    return seeOther(`/checkout/${await gatewayFor(request.headers).checkout(target.kind, target.slug, body)}`);
  } catch (error) {
    return seeOther(back(checkoutErrorCode(error instanceof GatewayError ? error.status : 0, target.sent)));
  }
}
