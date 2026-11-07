// Child process for web-neon.mjs: runs ONE statement through apps/web's real lib/server/db.ts (Neon HTTP driver), using
// the exact SQL the app exports. DATABASE_URL (the isolated target) arrives in this process's environment only.
// Barrier: prints READY, waits for "GO" on stdin, then runs, prints one JSON line and exits.
import { createInterface } from "node:readline";

const op = JSON.parse(process.env.WF_OP ?? "{}");
const { query } = await import("../../apps/web/lib/server/db.ts");
const webhooks = await import("../../apps/web/lib/server/webhooks.ts");
const http = await import("../../apps/web/lib/server/http.ts");
const SQL = { ...webhooks, RATE_LIMIT_SQL: http.RATE_LIMIT_SQL };
const rl = createInterface({ input: process.stdin });
process.stdout.write("READY\n");
for await (const line of rl) {
  if (line.trim() !== "GO") continue;
  rl.close();
  try {
    const rows = await query(SQL[op.sql], op.params);
    process.stdout.write(`${JSON.stringify({ ok: true, rows })}\n`);
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: e?.code ?? e?.name ?? "error" })}\n`);
  }
  break;
}
