// QR codes for links, pages and invoices (FR-GW-3), drawn on our server as SVG with uqr (unjs, MIT, no dependencies),
// so no QR code is in the browser bundle. Only our own payment pages get one: this is no open QR maker.
import { renderSVG } from "uqr";
import { SLUG } from "./gateway-client.ts";

const TARGETS = { l: SLUG, p: SLUG, pay: /^[1-9]\d{0,19}$/ } as const; // a link, a page, an invoice
export type QrKind = keyof typeof TARGETS;

/** The page a QR may point at ("/l/AbC…"), or null. */
export function qrTarget(kind: string, id: string): string | null {
  if (!Object.hasOwn(TARGETS, kind)) return null;
  return TARGETS[kind as QrKind].test(id) ? `/${kind}/${id}` : null;
}

/** An SVG of the QR for `url`: dark on white whatever the theme (scanners need it), level M (15% damage), a 4-module
 *  quiet zone as the standard asks. */
export const qrSvg = (url: string) => renderSVG(url, { ecc: "M", border: 4, pixelSize: 8, blackColor: "#12131c", whiteColor: "#ffffff" });
