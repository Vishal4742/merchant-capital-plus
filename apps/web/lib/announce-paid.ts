// Tells the gateway backend a checkout was paid (FR-GW-7, AT-14): claude-contracts' onSessionPaid marks a link or page
// checkout paid, counts a voucher, and sends payment.succeeded to the merchant's webhooks. It is idempotent, so every
// place that records a payment calls it. Server only.
import { after } from "next/server.js"; // the .js path resolves under Node's test runner too
import { onSessionPaid } from "./server/events.ts";
import type { Session } from "./sessions.ts";

/** Runs after the response is sent (Next's after()), so the first webhook POST (5 s timeout) never slows the payment
 *  reply (NFR-4). Outside a request (tests, scripts) after() throws, so it runs at once. A failure is logged by its
 *  name only (a database or network message could carry a URL) and never changes the payment's outcome. */
export function announcePaid(session: Session, send: (session: Session) => Promise<void> = onSessionPaid): void {
  const run = () =>
    send(session).catch((error: unknown) => {
      console.error(`payment.succeeded for ${session.id} not queued: ${error instanceof Error ? error.name : "error"}`);
    });
  try {
    after(run);
  } catch {
    void run();
  }
}
