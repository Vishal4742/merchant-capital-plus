#!/usr/bin/env node
// SANDBOX ONLY (batch 052, FR-MCP-16): the person's side of the simulator. It plays the payment provider (a customer
// paying), runs reconciliation, and shows the sandbox's state. It is not an MCP tool, on purpose: an assistant can never
// mark something paid. Prints no keys and no webhook secret.
//   whiteflow-sandbox init [--timezone Asia/Kolkata]
//   whiteflow-sandbox pay <WF-1001 | inv_… | lnk_… | slug> [--amount 12.50] [--scenario normal|duplicate|out-of-order|bad-signature|fail]
//   whiteflow-sandbox approve <apr_…> | reject <apr_…>   (the Owner, on the review page)
//   whiteflow-sandbox reconcile
//   whiteflow-sandbox status
import { parseMoney } from "../money.ts";
import { validZone } from "../dates.ts";
import { change, defaultStateDir, ensureSandbox, read } from "./store.ts";
import { reconcile, simulatePayment, type Scenario } from "./provider.ts";
import { decide } from "./records.ts";

const SCENARIOS: Scenario[] = ["normal", "duplicate", "out-of-order", "bad-signature", "fail"];

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export function run(argv: string[], env: Record<string, string | undefined>, out: (line: string) => void, now: () => number = Date.now): number {
  const [command, ...args] = argv;
  const dir = defaultStateDir(env);
  const zone = option(args, "timezone") ?? env.WHITEFLOW_TIMEZONE ?? "UTC";
  if (!validZone(zone)) throw new Error(`--timezone must be an IANA zone like Asia/Kolkata (got ${zone}).`);
  switch (command) {
    case "init": {
      const { created } = ensureSandbox(dir, zone);
      out(`${created ? "Created" : "Found"} the Whiteflow sandbox in ${dir} (simulated data only; no real money, no network).`);
      return 0;
    }
    case "pay": {
      const ref = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
      if (!ref) throw new Error("Usage: whiteflow-sandbox pay <WF-1001 | inv_… | lnk_… | slug> [--amount 12.50] [--scenario …]");
      const scenario = (option(args, "scenario") ?? "normal") as Scenario;
      if (!SCENARIOS.includes(scenario)) throw new Error(`--scenario must be one of ${SCENARIOS.join(", ")}.`);
      const amountText = option(args, "amount");
      const amountUnits = amountText === undefined ? undefined : parseMoney(amountText, "USDT", "--amount").units;
      const result = simulatePayment(dir, ref, { amountUnits, scenario });
      out(`SANDBOX: simulated payment ${result.payment_id} of ${result.amount} USDT for ${ref} (${scenario}). Signed provider events:`);
      for (const d of result.deliveries) out(`  ${d.type.padEnd(18)} ${d.outcome.padEnd(9)} ${d.reason}`);
      return 0;
    }
    case "approve":
    case "reject": {
      // SANDBOX stand-in for the business Owner's authenticated review page (production: a signed-in Owner, never a
      // tool). It decides one exact invoice revision once.
      const id = args.find((a) => /^apr_[\w-]{1,40}$/.test(a));
      if (!id) throw new Error(`Usage: whiteflow-sandbox ${command} <apr_…> (the id from finalize_invoice's result)`);
      const outcome = change(dir, (state) => {
        const { next, outcome } = decide(state, id, command, now());
        return { next, result: outcome };
      });
      const said = { approved: "approved: the invoice is published (open) with its number and payment URL", rejected: "rejected: the invoice stays a draft", superseded: "not applied: the draft changed after the request, so this approval no longer matches it" } as Record<string, string>;
      out(`SANDBOX Owner decision on ${id}: ${said[outcome] ?? outcome}.`);
      return outcome === "superseded" ? 1 : 0;
    }
    case "reconcile": {
      const { checked, drift } = reconcile(dir);
      out(`Reconciled ${checked} invoice(s) against verified payments: ${drift.length ? `${drift.length} corrected` : "no drift"}.`);
      for (const d of drift) out(`  ${d.invoice}: recorded ${d.recorded}, verified ${d.verified} (fixed)`);
      return 0;
    }
    case "status": {
      const s = read(dir);
      out(`Whiteflow sandbox in ${dir}: ${s.merchants.length} merchant(s), ${s.customers.length} customer(s), ${s.links.length} link(s), ${s.invoices.length} invoice(s), ${s.payments.length} payment(s).`);
      for (const e of s.event_log.slice(-10)) out(`  ${new Date(e.at).toISOString()} ${e.type.padEnd(18)} ${e.outcome.padEnd(9)} ${e.reason}`);
      return 0;
    }
    default:
      out("Usage: whiteflow-sandbox init | pay <ref> [--amount] [--scenario] | approve <apr_…> | reject <apr_…> | reconcile | status");
      return command ? 1 : 0;
  }
}

// run when executed directly (also inside the bundle), not when imported by a test
const entry = process.argv[1] ?? "";
if (/sandbox-cli\.(m?js|ts)$|sandbox[\\/]cli\.ts$/.test(entry)) {
  try {
    process.exitCode = run(process.argv.slice(2), process.env, (line) => process.stdout.write(`${line}\n`));
  } catch (error) {
    process.stderr.write(`whiteflow-sandbox: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
