// Hosted concurrency check (batch 058): N simultaneous identical create_payment_link calls with ONE idempotency key against
// the deployed endpoint and its real hosted Postgres. Expected: exactly one distinct link. This is the evidence PGlite can't
// give: separate serverless instances racing on the shared database's compare-and-swap journal.
//
//   MCP_URL=https://<staging mcp>/mcp ACCESS_TOKEN=<a staging access token with links:write> node scripts/staging-concurrency.mjs
//
// Creates ONE test link in whatever database the endpoint uses (staging, Whitechain Testnet, no money). The token is read
// from the environment and never printed; output is counts only.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_URL, token = process.env.ACCESS_TOKEN;
const N = Number(process.env.CONCURRENCY ?? 20);
if (!url || !token) {
  console.error("MCP_URL and ACCESS_TOKEN are required");
  process.exit(2);
}
if (!url.startsWith("https://")) {
  console.error("MCP_URL must be https (this check is for a hosted deployment)");
  process.exit(2);
}
const key = `conc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function one() {
  const client = new Client({ name: "concurrency-check", version: "0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const result = await client.callTool({ name: "create_payment_link", arguments: { amount: "1.00", currency: "USDT", description: "Concurrency check", idempotency_key: key } });
    const text = result.content.map((p) => p.text).join("");
    let body = {};
    try { body = JSON.parse(text); } catch { /* plain text */ }
    return { ok: !result.isError, id: body.link?.id ?? null, replayed: body.replayed === true, refused: result.isError ? String(body.error ?? "error").slice(0, 80) : null };
  } catch (error) {
    return { ok: false, id: null, replayed: false, refused: `transport: ${error instanceof Error ? error.name : "error"}` };
  } finally {
    await client.close().catch(() => undefined);
  }
}

const results = await Promise.all(Array.from({ length: N }, one));
const ids = new Set(results.filter((r) => r.id).map((r) => r.id));
const refusals = {};
for (const r of results) if (r.refused) refusals[r.refused] = (refusals[r.refused] ?? 0) + 1;
console.log(JSON.stringify({ requests: N, succeeded: results.filter((r) => r.ok).length, replayed: results.filter((r) => r.replayed).length, distinct_links: ids.size, refusals }, null, 2));
// pass: at least one request succeeded and they all agree on ONE link
process.exit(ids.size === 1 ? 0 : 1);
