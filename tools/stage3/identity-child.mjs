// Child process for identity-neon.mjs (batch 050, spec 032 R2-5): runs ONE Stage 3 service call through apps/web's real
// lib/server/db.ts (Neon HTTP driver, production adapter) with a server-built AuthContext. DATABASE_URL (the isolated
// target) and PUBLIC_ORIGIN arrive in this process's environment only. Barrier: prints READY, waits for "GO" on stdin,
// then runs, prints one JSON line {ok, status, error, result} and exits.
import { createInterface } from "node:readline";

const op = JSON.parse(process.env.WF_OP ?? "{}");
const businesses = await import("../../apps/web/lib/server/businesses.ts");
const policies = await import("../../apps/web/lib/server/policies.ts");
const { scopesFor } = await import("../../apps/web/lib/server/identity.ts");

const ctx = {
  principalId: op.ctx.principalId,
  businessId: op.ctx.businessId,
  role: op.ctx.role,
  scopes: scopesFor(op.ctx.role),
  source: "session",
  credentialId: op.ctx.sessionId,
  requestId: `stage3-${process.pid}`,
};
const run = {
  role: () => businesses.setMemberRole(ctx, op.args),
  remove: () => businesses.removeMember(ctx, op.args),
  activate: () => policies.activatePolicy(ctx, op.args, { obligations: async () => false }),
}[op.kind];

const rl = createInterface({ input: process.stdin });
process.stdout.write("READY\n");
for await (const line of rl) {
  if (line.trim() !== "GO") continue;
  rl.close();
  try {
    const result = await run();
    process.stdout.write(`${JSON.stringify({ ok: true, status: 200, result })}\n`);
  } catch (e) {
    // the status and our own message only (HttpError); a driver error gives its SQLSTATE or name, never its text
    const status = typeof e?.status === "number" ? e.status : 500;
    process.stdout.write(`${JSON.stringify({ ok: false, status, error: status < 500 ? e.message : (e?.code ?? e?.name ?? "error") })}\n`);
  }
  break;
}
