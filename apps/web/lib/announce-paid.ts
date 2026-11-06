// Tells the gateway backend a checkout was paid (FR-GW-7, AT-14): claude-contracts' onSessionPaid marks a link or page
// checkout paid, counts a voucher, and sends payment.succeeded to the merchant's webhooks. It is idempotent, so every
// place that records a payment calls it. Server only.
import { after } from "next/server.js"; // the .js path resolves under Node's test runner too
import { onSessionPaid } from "./server/events.ts";
import type { Session } from "./sessions.ts";

const RETRY_GAPS_MS = [500, 1_500];

/** `paidAmount` is the attempt's charged price (security 009 F3): what claimAmountDue returned and was relayed, or the
 *  session's amount for a shop's own session. The voucher is counted and the webhook reports at exactly that price.
 *  Runs after the response is sent (Next's after()), so the first webhook POST (5 s timeout) never slows the payment
 *  reply (NFR-4). Outside a request (tests, scripts) after() throws, so it runs at once. A failure is logged by its
 *  name only (a database or network message could carry a URL) and never changes the payment's outcome. */
export function announcePaid(
  session: Session,
  paidAmount: bigint,
  send: (session: Session, paidAmount: bigint) => Promise<void> = onSessionPaid,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): void {
  // 3 tries: one database blip must not leave a single-use link payable again, a code uncounted or the merchant's
  // webhook unsent (G4 code review M2). The paid checkout page and its receipt also re-announce; it is idempotent.
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await send(session, paidAmount);
        return;
      } catch (error: unknown) {
        console.error(`payment.succeeded for ${session.id} not queued (try ${attempt + 1}): ${error instanceof Error ? error.name : "error"}`);
        if (attempt >= RETRY_GAPS_MS.length) return;
        await wait(RETRY_GAPS_MS[attempt]);
      }
    }
  };
  try {
    after(run);
  } catch {
    void run();
  }
}
