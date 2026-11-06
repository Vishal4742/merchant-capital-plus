// GET /qr/{l|p|pay}/{id}: the QR code of a payment link, page or invoice as an SVG (FR-GW-3), for this server's own URL.
// `?download=1` saves it as a file. Shown in an <img> (img-src 'self'), so no QR code is ever in a page's script.
import { publicOrigin } from "../../../../lib/config.ts";
import { originOf } from "../../../../lib/gateway-server.ts";
import { qrSvg, qrTarget } from "../../../../lib/qr.ts";

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const path = qrTarget(kind, id);
  if (!path) return new Response("No such page.", { status: 404 });
  const download: Record<string, string> = new URL(request.url).searchParams.has("download") ? { "content-disposition": `attachment; filename="qr-${kind}-${id}.svg"` } : {};
  // the host the merchant reached (request.url names the server's own host under `next start`)
  return new Response(qrSvg(`${publicOrigin(originOf(request.headers))}${path}`), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // opened on its own, the SVG is a document on our origin: it may load and run nothing
      "content-security-policy": "default-src 'none'",
      "cache-control": "private, max-age=3600",
      ...download,
    },
  });
}
