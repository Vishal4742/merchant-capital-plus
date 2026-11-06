// Sharing a link, page or invoice (FR-GW-1–3): the URL in a mono pill with Copy, and its QR code, drawn on our server
// (GET /qr/…) and shown as an image, with a download and a full-screen counter view. No hooks: works in any screen.
import { CopyButton } from "@/components/CopyButton";
import type { QrKind } from "@/lib/qr"; // a type only: uqr never reaches the browser

export function LinkPill({ url, name }: { url: string; name: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-pill border border-hairline bg-surface py-1 pr-1 pl-4">
      <span className="data min-w-0 flex-1 truncate" title={url}>
        {url.replace(/^https?:\/\//, "")}
      </span>
      <CopyButton text={url} name={name} />
    </div>
  );
}

/** The id a link's or page's webhooks carry (data.link_id / data.page_id, lib/server/events.ts), with Copy: how the
 *  merchant's server tells which link or page a payment came from. */
export function WebhookId({ field, id, name }: { field: "link_id" | "page_id"; id: string; name: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <p className="min-w-0 flex-1 text-ink-muted">
        Webhooks for this {field === "link_id" ? "link" : "page"} carry <code className="data break-words text-ink">data.{field} = {id}</code>
      </p>
      <CopyButton text={id} name={`the id of ${name}`} />
    </div>
  );
}

const action = "inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4";

export function QrActions({ kind, id, name }: { kind: QrKind; id: string; name: string }) {
  const src = `/qr/${kind}/${id}`;
  return (
    <details className="group relative">
      <summary className={`${action} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        QR code<span aria-hidden="true" className="ml-1 no-underline transition-transform group-open:rotate-180">▾</span>
      </summary>
      {/* in the flow, not floating: a lifted card next to it would paint over a floating panel */}
      <div className="mt-1 grid w-60 max-w-full gap-1 rounded-[16px] border border-hairline bg-surface p-3 shadow-card">
        {/* eslint-disable-next-line @next/next/no-img-element -- our own SVG route; next/image would only re-serve it */}
        <img src={src} alt={`QR code for ${name}`} width={216} height={216} loading="lazy" className="aspect-square w-full rounded-[10px] border border-hairline bg-white" />
        <a href={`${src}?download=1`} download className={action}>
          Download SVG
        </a>
        {/* a full load: the counter view has its own CSP */}
        <a href={`/counter/${kind}/${id}`} className={action}>
          Show at the counter
        </a>
      </div>
    </details>
  );
}
