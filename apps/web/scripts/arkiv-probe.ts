// DEP-5 probe: one Arkiv create + query on Rabdi with the web app's writer (ARCHITECTURE §5).
// Run from apps/web: node --env-file=../../.env scripts/arkiv-probe.ts
// Prints public values only (writer address, entity key, tx hash, timings); errors are redacted.
import { ExpirationTime } from "@arkiv-network/sdk";
import { eq } from "@arkiv-network/sdk/query";
import { defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import { arkivClients, redactArkivError } from "../lib/arkiv.ts";

const Probe = defineSchema("mcplus.probe.v1", { note: str().indexed(), at: u64().indexed() });
const PROBE_TTL_MIN = 30;

try {
  const { reader, writer, address } = arkivClients();
  const at = BigInt(Math.floor(Date.now() / 1000));
  const t0 = performance.now();
  const { entityKey, txHash } = await writer.createEntity(Probe, { note: "dep-5 probe", at: u64(at) }, { expiration: ExpirationTime.fromMinutes(PROBE_TTL_MIN) });
  const t1 = performance.now();
  const page = await reader.select({ $key: true, note: true, at: true }).from(Probe).where(eq("at", u64(at))).ownedBy(address).limit(5).fetch();
  const t2 = performance.now();
  const found = page.entities.some((e) => e.$key === entityKey);
  console.log(JSON.stringify({ writer: address, entityKey, txHash, createMs: Math.round(t1 - t0), queryMs: Math.round(t2 - t1), found, expiresInMin: PROBE_TTL_MIN }, null, 2));
  if (!found) process.exitCode = 1;
} catch (err) {
  console.error(`Arkiv probe failed: ${redactArkivError(err, process.env.ARKIV_ACCESS_KEY)}`);
  process.exitCode = 1;
}
