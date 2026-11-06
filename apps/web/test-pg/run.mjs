// Batch 031 Part D (FR-GW-7, FR-PAY-10): real-Postgres concurrency evidence for the webhook outbox and its lease.
// Opt-in, from apps/web: npm run test:pg   (exit 0 = pass, 1 = fail, 77 = SKIPPED: no Postgres binaries)
// The PGlite tests in test/ run on one embedded connection, so their statements never truly race. Here every statement
// runs from its own psql process (its own connection and backend), all released at the same instant by a gate
// (cluster.mjs race()), against a throwaway cluster with every db/NNN_*.sql applied by the production splitter.
// The SQL is the EXACT text the app runs: imported from lib/server/webhooks.ts (A13 exports), never copied.
// Knobs: TEST_PG_WORKERS (connections per race, default 16), TEST_PG_ROUNDS (races per scenario, default 8), PG_BIN.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { sqlStatements } from "../db/statements.mjs";
import { SKIP_EXIT, applyMigrations, assertPsqlSafe, findPgBin, lit, race, scalar, sql, startCluster, stopCluster } from "./cluster.mjs";

const found = findPgBin();
if (!found.dir) {
  console.log("\n==============================================================");
  console.log("SKIPPED: postgres binaries not found (need initdb, pg_ctl, postgres, psql >= 16)");
  console.log("Set PG_BIN to the bin directory to run. Searched:");
  for (const d of found.searched.slice(0, 12)) console.log(`  ${d}`);
  console.log("This is a SKIP, not a pass.");
  console.log("==============================================================\n");
  process.exit(SKIP_EXIT);
}

const int = (v, d, min, max) => {
  const n = v === undefined || v === "" ? d : Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`expected an integer ${min}..${max}, got ${v}`);
  return n;
};
const WORKERS = int(process.env.TEST_PG_WORKERS, 16, 3, 150);
const ROUNDS = int(process.env.TEST_PG_ROUNDS, 8, 1, 200);

const W = await import("../lib/server/webhooks.ts");
const NAMES = ["SQL_ENQUEUE_ONCE", "SQL_CLAIM_LEASE", "SQL_CLAIM_FIRST_ATTEMPT", "SQL_OUTCOME", "SQL_DEFER", "SQL_DISPATCH_CLAIM"];
for (const name of NAMES) assertPsqlSafe(name, W[name]);

// Parameter VALUES only (the SQL is imported). webhooks.ts passes leased_until = now + its 60 s lease; times are unix ms.
const LEASE_MS = 60_000;
const DISPATCH_LIMIT = 30;
const PER_DESTINATION = 3;
const T0 = 1_800_000_000_000;
const M1 = "0x1111111111111111111111111111111111111111";
const M2 = "0x2222222222222222222222222222222222222222";
const HOOKS = [
  ["whk_pg_a", M1],
  ["whk_pg_b", M1],
  ["whk_pg_c", M1],
  ["whk_pg_z", M2],
];
const merchantOf = Object.fromEntries(HOOKS);
const md5 = (s) => createHash("md5").update(s).digest("hex");
const vals = (xs) => {
  const set = [...new Set(xs.map(String))];
  return set.length === 1 ? set[0] : `{${set.join(",")}}`;
};

let c; // the cluster

const insertDelivery = (d) =>
  `INSERT INTO app_gw_deliveries (id, webhook_id, merchant, event_id, event, body, status, attempts, next_attempt_at, created_at, leased_until) VALUES (${[
    d.id,
    d.webhook,
    merchantOf[d.webhook],
    `evt_${d.id}`,
    "payment.succeeded",
    JSON.stringify({ id: `evt_${d.id}` }),
    d.status ?? "pending",
    d.attempts ?? 0,
    d.next ?? null,
    d.created ?? T0,
    d.leased ?? null,
  ]
    .map(lit)
    .join(", ")})`;
const row = async (id) => {
  const [r] = await sql(c, `SELECT status, attempts, coalesce(next_attempt_at::text, 'null'), coalesce(response_status::text, 'null'), coalesce(leased_until::text, 'null') FROM app_gw_deliveries WHERE id = ${lit(id)}`);
  return r ? { status: r[0], attempts: r[1], next: r[2], response: r[3], leased: r[4] } : null;
};

/** One scenario's bookkeeping: every race() goes through s.race so the table can show connection evidence. */
function scenario(name) {
  const s = { name, races: 0, conns: 0, workers: 0, pidsDistinct: true, spreadMs: 0, failures: [], notes: [] };
  s.check = (ok, msg) => {
    if (!ok && s.failures.length < 20) s.failures.push(msg);
    return ok;
  };
  s.race = async (jobs) => {
    const res = await race(c, jobs);
    s.races++;
    s.conns += jobs.length;
    s.workers = Math.max(s.workers, jobs.length);
    if (new Set(res.map((r) => r.pid)).size !== jobs.length) s.pidsDistinct = false;
    const starts = res.map((r) => r.startUs);
    s.spreadMs = Math.max(s.spreadMs, (Math.max(...starts) - Math.min(...starts)) / 1000);
    return res;
  };
  return s;
}

// (1) enqueue-once CTE racing N ways on one key → exactly one marker, exactly one delivery per endpoint.
async function enqueueOnce() {
  const s = scenario(`enqueue-once CTE: 1 key x ${WORKERS} instances`);
  const m1Hooks = HOOKS.filter(([, m]) => m === M1).map(([id]) => id);
  const seen = { winners: [], markers: [], deliveries: [], endpoints: [], bodies: [], other: [] };
  for (let r = 0; r < ROUNDS; r++) {
    const t = T0 + r * 10_000_000;
    const key = `paid:sess_pg_${r}`;
    const eventId = `evt_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`; // stable per key, like events.ts
    const bodies = [];
    const jobs = Array.from({ length: WORKERS }, (_, i) => {
      const now = t + i; // each instance has its own clock, so each would write a different body
      const body = JSON.stringify({ id: eventId, type: "payment.succeeded", created: Math.floor(now / 1000), data: { session: `sess_pg_${r}`, instance: i } });
      bodies.push(body);
      return { tag: `enqueue#${i}`, sql: W.SQL_ENQUEUE_ONCE, params: [key, now, eventId, "payment.succeeded", body, now + LEASE_MS, M1.toLowerCase()] };
    });
    const res = await s.race(jobs);
    const winners = res.map((x, i) => ({ ...x, i })).filter((x) => x.rows.length > 0);
    seen.winners.push(winners.length);
    const expected = m1Hooks.map((h) => `dlv_${md5(`${h}:${eventId}`).slice(0, 24)}`).sort();
    s.check(winners.length === 1, `race ${r}: ${winners.length} instances queued deliveries (want exactly 1)`);
    if (winners.length === 1) s.check(winners[0].rows.map((x) => x[0]).join(",") === expected.join(","), `race ${r}: winner returned ${winners[0].rows.map((x) => x[0])} (want ${expected})`);
    const markers = await scalar(c, `SELECT count(*) FROM app_gw_events WHERE key = ${lit(key)}`);
    const [n, endpoints, ids, distinctBodies, other] = (
      await sql(c, `SELECT count(*), count(DISTINCT webhook_id), string_agg(id, ',' ORDER BY id), count(DISTINCT body), count(*) FILTER (WHERE merchant <> ${lit(M1.toLowerCase())}) FROM app_gw_deliveries WHERE event_id = ${lit(eventId)}`)
    )[0];
    seen.markers.push(markers);
    seen.deliveries.push(n);
    seen.endpoints.push(endpoints);
    seen.bodies.push(distinctBodies);
    seen.other.push(other);
    s.check(markers === "1", `race ${r}: ${markers} app_gw_events markers (want 1)`);
    s.check(n === String(m1Hooks.length) && endpoints === String(m1Hooks.length), `race ${r}: ${n} deliveries over ${endpoints} endpoints (want ${m1Hooks.length}/${m1Hooks.length})`);
    s.check(ids === expected.join(","), `race ${r}: delivery ids ${ids} (want md5(webhook:event) ids ${expected})`);
    s.check(distinctBodies === "1" && other === "0", `race ${r}: ${distinctBodies} distinct bodies, ${other} deliveries for another merchant (want 1, 0)`);
    if (winners.length === 1) {
      const body = await scalar(c, `SELECT DISTINCT body FROM app_gw_deliveries WHERE event_id = ${lit(eventId)}`);
      s.check(body === bodies[winners[0].i], `race ${r}: stored body is not the winning instance's body`);
    }
  }
  s.notes.push(`instances that queued/race=${vals(seen.winners)}  markers/key=${vals(seen.markers)}  deliveries/key=${vals(seen.deliveries)} over endpoints=${vals(seen.endpoints)} (md5(webhook:event) ids)  bodies=${vals(seen.bodies)}  other merchant=${vals(seen.other)}`);
  return s;
}

// (2) claim-lease racing N ways on one delivery → exactly one winner, and the stored lease is the winner's.
async function claimLease() {
  const s = scenario(`claim-lease: 1 delivery x ${WORKERS} claimers`);
  const seen = { winners: [], leaseIsWinners: [] };
  for (let r = 0; r < ROUNDS; r++) {
    const t = T0 + r * 10_000_000;
    const id = `dlv_pg_claim_${r}`;
    await sql(c, insertDelivery({ id, webhook: "whk_pg_a", next: t - 1, created: t - 1 }));
    const jobs = Array.from({ length: WORKERS }, (_, i) => ({ tag: `claim#${i}`, sql: W.SQL_CLAIM_LEASE, params: [id, t + i + LEASE_MS, t + i] }));
    const res = await s.race(jobs);
    const winners = res.map((x, i) => ({ ...x, i })).filter((x) => x.rows.length === 1 && x.rows[0][0] === id);
    seen.winners.push(winners.length);
    s.check(winners.length === 1, `race ${r}: ${winners.length} claimers won (want exactly 1)`);
    s.check(res.every((x) => x.rows.length <= 1), `race ${r}: a claim returned more than one row`);
    const leased = (await row(id)).leased;
    const ok = winners.length === 1 && leased === String(jobs[winners[0].i].params[1]);
    seen.leaseIsWinners.push(ok ? "yes" : "no");
    s.check(ok, `race ${r}: stored leased_until ${leased} is not the winner's lease`);
  }
  s.notes.push(`winners/race=${vals(seen.winners)}  stored lease = winner's: ${vals(seen.leaseIsWinners)}`);
  return s;
}

// (3) dispatch claim vs replay claim vs inline first-attempt claim on one due delivery → never two holders at once:
// wave 1 (free) one holder; wave 2 (lease live) nobody; wave 3 (lease expired: takeover) one new holder.
async function mixedClaims() {
  const s = scenario(`dispatch vs replay vs inline claim: ${WORKERS} mixed`);
  const kinds = ["dispatch", "replay", "inline"];
  const holders = { 1: [], 2: [], 3: [] };
  const wonBy = { 1: { dispatch: 0, replay: 0, inline: 0 }, 3: { dispatch: 0, replay: 0, inline: 0 } };
  const jobsAt = (id, base) =>
    Array.from({ length: WORKERS }, (_, i) => {
      const now = base + i;
      const kind = kinds[i % 3];
      if (kind === "dispatch") return { tag: kind, sql: W.SQL_DISPATCH_CLAIM, params: [now, now + LEASE_MS, DISPATCH_LIMIT, PER_DESTINATION] };
      return { tag: kind, sql: kind === "replay" ? W.SQL_CLAIM_LEASE : W.SQL_CLAIM_FIRST_ATTEMPT, params: [id, now + LEASE_MS, now] };
    });
  for (let r = 0; r < ROUNDS; r++) {
    const t = T0 + r * 10_000_000;
    const id = `dlv_pg_mixed_${r}`;
    await sql(c, `DELETE FROM app_gw_deliveries; ${insertDelivery({ id, webhook: "whk_pg_b", next: t - 1_000, created: t - 1_000 })}`);
    let lease = null;
    for (const [wave, base] of [
      [1, t],
      [2, t + LEASE_MS / 2],
      [3, null],
    ]) {
      const jobs = jobsAt(id, base ?? Number(lease) + 1);
      const res = await s.race(jobs);
      s.check(res.every((x) => x.rows.every((rw) => rw[0] === id)), `race ${r} wave ${wave}: a claim returned a row other than the one due delivery`);
      const won = res.map((x, i) => ({ ...x, i })).filter((x) => x.rows.some((rw) => rw[0] === id));
      holders[wave].push(won.length);
      const want = wave === 2 ? 0 : 1;
      s.check(won.length === want, `race ${r} wave ${wave}: ${won.length} holders (${won.map((w) => w.tag).join(",")}), want ${want}`);
      const stored = (await row(id)).leased;
      if (wave === 2) s.check(stored === lease, `race ${r} wave 2: lease changed from ${lease} to ${stored} while live`);
      else if (won.length === 1) {
        wonBy[wave][won[0].tag]++;
        const mine = String(jobs[won[0].i].params[1]); // $2 = the new leased_until in all three statements
        s.check(stored === mine, `race ${r} wave ${wave}: stored lease ${stored} is not the holder's ${mine}`);
        lease = stored;
      }
    }
  }
  const by = (w) => kinds.map((k) => `${k} ${wonBy[w][k]}`).join(" / ");
  s.notes.push(`free: holders=${vals(holders[1])} (won by ${by(1)})  lease live: holders=${vals(holders[2])}  after expiry: holders=${vals(holders[3])} (won by ${by(3)})`);
  return s;
}

// (4) a fenced outcome after a takeover is dropped (0 rows) and the new holder's outcome stands.
async function fencedOutcome() {
  const s = scenario(`fenced outcome after takeover: 1 new + ${WORKERS - 1} stale writers`);
  const seen = { takeover: [], newRows: [], staleRows: [], final: [] };
  for (let r = 0; r < ROUNDS; r++) {
    const t = T0 + r * 10_000_000;
    const id = `dlv_pg_fence_${r}`;
    const leaseA = t + LEASE_MS; // A claimed at t, then stalled past its lease
    await sql(c, insertDelivery({ id, webhook: "whk_pg_c", next: t - 1, created: t - 1, leased: leaseA }));
    const tB = leaseA + 1;
    const leaseB = tB + LEASE_MS;
    const [takeover] = await s.race([{ tag: "B claim", sql: W.SQL_CLAIM_LEASE, params: [id, leaseB, tB] }]);
    seen.takeover.push(takeover.rows.length);
    s.check(takeover.rows.length === 1, `race ${r}: B's takeover claim returned ${takeover.rows.length} rows (want 1)`);
    const jobs = [{ tag: "B outcome", sql: W.SQL_OUTCOME, params: [id, 1, "pending", tB + 60_000, 500, leaseB] }];
    for (let i = 1; i < WORKERS; i++) {
      jobs.push(
        i % 2
          ? { tag: "A stale outcome", sql: W.SQL_OUTCOME, params: [id, 1, "pending", t + 60_000 + i, 503, leaseA] }
          : { tag: "A stale defer", sql: W.SQL_DEFER, params: [id, t + 120_000 + i, leaseA] },
      );
    }
    const res = await s.race(jobs);
    seen.newRows.push(res[0].rows.length);
    const stale = res.slice(1).reduce((n, x) => n + x.rows.length, 0);
    seen.staleRows.push(stale);
    s.check(res[0].rows.length === 1, `race ${r}: B's outcome updated ${res[0].rows.length} rows (want 1)`);
    s.check(stale === 0, `race ${r}: stale A writes updated ${stale} rows (want 0)`);
    const f = await row(id);
    const ok = f.status === "pending" && f.attempts === "1" && f.response === "500" && f.next === String(tB + 60_000) && f.leased === "null";
    seen.final.push(ok ? "B's" : JSON.stringify(f));
    s.check(ok, `race ${r}: final row ${JSON.stringify(f)} is not B's outcome`);
  }
  // (4b) the stale outcome races the takeover claim itself: either order is legal, but the new holder's lease is never clobbered
  const pairs = Math.max(1, Math.floor(WORKERS / 2));
  let aLanded = 0;
  let aDropped = 0;
  let clobbered = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const t = T0 + 500_000_000 + r * 10_000_000;
    const leaseA = t + LEASE_MS;
    const ids = Array.from({ length: pairs }, (_, p) => `dlv_pg_fence2_${r}_${p}`);
    await sql(c, ids.map((id) => insertDelivery({ id, webhook: "whk_pg_c", next: t - 1, created: t - 1, leased: leaseA })).join(";\n"));
    const jobs = ids.flatMap((id, p) => [
      { tag: "A stale outcome", sql: W.SQL_OUTCOME, params: [id, 1, "pending", t + 60_000, 503, leaseA] },
      { tag: "B claim", sql: W.SQL_CLAIM_LEASE, params: [id, leaseA + 1 + p + LEASE_MS, leaseA + 1 + p] },
    ]);
    const res = await s.race(jobs);
    for (let p = 0; p < pairs; p++) {
      const [a, b] = [res[2 * p], res[2 * p + 1]];
      const f = await row(ids[p]);
      const leaseB = String(jobs[2 * p + 1].params[1]);
      s.check(b.rows.length === 1, `pair ${r}/${p}: takeover claim returned ${b.rows.length} rows (want 1)`);
      if (f.leased !== leaseB) clobbered++;
      if (a.rows.length === 1) {
        aLanded++;
        s.check(f.attempts === "1" && f.response === "503", `pair ${r}/${p}: A landed first but its outcome is missing: ${JSON.stringify(f)}`);
      } else {
        aDropped++;
        s.check(f.attempts === "0" && f.response === "null", `pair ${r}/${p}: A was dropped but the row changed: ${JSON.stringify(f)}`);
      }
    }
  }
  s.check(clobbered === 0, `${clobbered} takeovers lost their lease to a stale outcome (want 0)`);
  s.notes.push(`takeover claim rows=${vals(seen.takeover)}  new holder's outcome rows=${vals(seen.newRows)}  stale rows/race=${vals(seen.staleRows)}  final=${vals(seen.final)}`);
  s.notes.push(`stale outcome vs takeover claim, ${aLanded + aDropped} pairs: stale landed first ${aLanded}, dropped ${aDropped}; new holder's lease clobbered ${clobbered}`);
  return s;
}

// (5) A11 fair dispatch claim (window function, no SKIP LOCKED): cap per destination, and concurrent dispatchers over the
// same due set claim disjoint sets (the outer WHERE re-check under READ COMMITTED drops rows another claimer took).
async function dispatchClaims() {
  const s = scenario(`dispatch claim: cap ${PER_DESTINATION}/destination, ${WORKERS} dispatchers`);
  const t = T0 + 900_000_000;
  const due = [];
  const fixtures = [];
  for (let k = 0; k < 10; k++) due.push({ id: `dlv_pg_disp_a${String(k).padStart(2, "0")}`, webhook: "whk_pg_a", next: t - 100_000 + k * 1_000 });
  due.push({ id: "dlv_pg_disp_b00", webhook: "whk_pg_b", next: t - 50_000 });
  for (let k = 0; k < 5; k++) due.push({ id: `dlv_pg_disp_c${String(k).padStart(2, "0")}`, webhook: "whk_pg_c", next: t - 99_500 + k * 1_000 });
  const distractors = [
    { id: "dlv_pg_disp_x_live", webhook: "whk_pg_c", next: t - 200_000, leased: t + 30_000 }, // lease still live
    { id: "dlv_pg_disp_x_future", webhook: "whk_pg_b", next: t + 10_000 }, // not due yet
    { id: "dlv_pg_disp_x_done", webhook: "whk_pg_a", next: t - 200_000, status: "succeeded" },
    { id: "dlv_pg_disp_x_failed", webhook: "whk_pg_z", next: t - 200_000, status: "failed", attempts: 4 },
  ];
  fixtures.push(...due, ...distractors);
  await sql(c, `DELETE FROM app_gw_deliveries;\n${fixtures.map((d) => insertDelivery({ ...d, created: t - 300_000 })).join(";\n")}`);
  const distractorState = async () => (await sql(c, `SELECT id, coalesce(leased_until::text, 'null') FROM app_gw_deliveries WHERE id LIKE 'dlv_pg_disp_x_%' ORDER BY id`)).map((x) => x.join("=")).join(" ");
  const before = await distractorState();
  const perDest = (ids) => ids.reduce((m, id) => ((m[id.slice(12, 13)] = (m[id.slice(12, 13)] ?? 0) + 1), m), {});

  // 5a: one dispatcher alone: the 3 oldest of the 10-row destination, the 1 of the 1-row one, the 3 oldest of the 5-row one
  const [solo] = await s.race([{ tag: "dispatch", sql: W.SQL_DISPATCH_CLAIM, params: [t, t + LEASE_MS, DISPATCH_LIMIT, PER_DESTINATION] }]);
  const soloIds = solo.rows.map((x) => x[0]).sort();
  const want = ["dlv_pg_disp_a00", "dlv_pg_disp_a01", "dlv_pg_disp_a02", "dlv_pg_disp_b00", "dlv_pg_disp_c00", "dlv_pg_disp_c01", "dlv_pg_disp_c02"];
  s.check(soloIds.join(",") === want.join(","), `solo claim returned ${soloIds} (want ${want})`);
  const pd = perDest(soloIds);
  s.notes.push(`solo claim (10 due on A, 1 on B, 5 on C; cap ${PER_DESTINATION}): A=${pd.a ?? 0} (oldest) B=${pd.b ?? 0} C=${pd.c ?? 0}; live-leased/not-due/succeeded/failed rows untouched`);

  // 5b: N dispatchers at once over the same due set, ROUNDS times
  let maxPerDest = 0;
  let dupes = 0;
  let wrongLease = 0;
  const claimedTotals = [];
  const claimers = [];
  for (let r = 0; r < ROUNDS; r++) {
    await sql(c, `UPDATE app_gw_deliveries SET leased_until = NULL WHERE id IN (${due.map((d) => lit(d.id)).join(", ")})`);
    const base = t + r * 100; // all well before every due row's lease would expire, after every row is due
    const jobs = Array.from({ length: WORKERS }, (_, i) => ({ tag: `dispatch#${i}`, sql: W.SQL_DISPATCH_CLAIM, params: [base + i, base + i + LEASE_MS, DISPATCH_LIMIT, PER_DESTINATION] }));
    const res = await s.race(jobs);
    const all = res.flatMap((x) => x.rows.map((rw) => rw[0]));
    dupes += all.length - new Set(all).size;
    claimedTotals.push(all.length);
    claimers.push(res.filter((x) => x.rows.length > 0).length);
    for (const x of res) maxPerDest = Math.max(maxPerDest, ...Object.values(perDest(x.rows.map((rw) => rw[0]))), 0);
    const stored = Object.fromEntries((await sql(c, `SELECT id, coalesce(leased_until::text, 'null') FROM app_gw_deliveries WHERE id LIKE 'dlv_pg_disp_%' AND id NOT LIKE 'dlv_pg_disp_x_%'`)).map(([id, l]) => [id, l]));
    res.forEach((x, i) => {
      for (const [id] of x.rows) if (stored[id] !== String(jobs[i].params[1])) wrongLease++;
    });
    const unclaimedLeased = due.filter((d) => !all.includes(d.id) && stored[d.id] !== "null").length;
    s.check(unclaimedLeased === 0, `round ${r}: ${unclaimedLeased} rows leased that no dispatcher returned`);
    s.check(all.every((id) => due.some((d) => d.id === id)), `round ${r}: a dispatcher claimed a row that is not due/free/pending`);
  }
  const after = await distractorState();
  s.check(dupes === 0, `${dupes} rows claimed by two dispatchers in the same race (want 0)`);
  s.check(wrongLease === 0, `${wrongLease} claimed rows hold another dispatcher's lease (want 0)`);
  s.check(maxPerDest <= PER_DESTINATION, `a dispatcher claimed ${maxPerDest} rows of one destination (cap ${PER_DESTINATION})`);
  s.check(after === before, `distractor rows changed: ${before} -> ${after}`);
  s.notes.push(`concurrent: rows claimed/race=${vals(claimedTotals)} of ${due.length} due, by ${vals(claimers)} dispatchers; duplicate claims ${dupes}; foreign-lease rows ${wrongLease}; max per destination per dispatcher ${maxPerDest}`);
  return s;
}

// (6) re-applying every migration is a no-op: same schema, same relfilenodes (nothing rebuilt), same data.
async function fingerprint() {
  const schema = await scalar(
    c,
    `SELECT md5(string_agg(x, chr(10) ORDER BY x)) || ' ' || count(*) FROM (
       SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS x FROM information_schema.columns WHERE table_schema = 'public'
       UNION ALL SELECT 'idx ' || indexname || ' ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
       UNION ALL SELECT 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) FROM pg_constraint WHERE connamespace = 'public'::regnamespace
     ) s`,
  );
  const files = await scalar(c, `SELECT md5(string_agg(relname || ':' || relfilenode, ',' ORDER BY relname)) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'i')`);
  const tables = (await sql(c, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((x) => x[0]);
  const data = await sql(c, tables.map((tb) => `SELECT ${lit(tb)}, count(*), md5(coalesce(string_agg(x::text, chr(10) ORDER BY x::text), '')) FROM ${tb} x`).join(" UNION ALL "));
  return { schema, files, data: data.map((x) => x.join(":")).join(" "), tables: tables.length, rows: data.reduce((n, x) => n + Number(x[1]), 0) };
}
async function reapply(dbDir) {
  const s = scenario("re-apply all migrations (with data present)");
  const before = await fingerprint();
  const { applied, notices } = await applyMigrations(c, dbDir, sqlStatements);
  const after = await fingerprint();
  s.check(before.schema === after.schema, `schema changed: ${before.schema} -> ${after.schema}`);
  s.check(before.files === after.files, "a table or index was rewritten/rebuilt (relfilenode changed)");
  s.check(before.data === after.data, "table data changed");
  s.notes.push(`${applied.length} files / ${applied.reduce((n, f) => n + f.statements, 0)} statements re-applied, exit 0, ${notices} "already exists, skipping" notices; schema (${before.schema.split(" ")[1]} objects), relfilenodes and data of ${before.tables} tables / ${before.rows} rows identical`);
  return s;
}

function printTable(results) {
  const head = ["#", "scenario", "races", "max conns/race", "total conns", "distinct pids/race", "max start spread", "result"];
  const rows = results.map((s, i) => [
    String(i + 1),
    s.name,
    String(s.races),
    s.races ? String(s.workers) : "-",
    s.races ? String(s.conns) : "-",
    s.races ? (s.pidsDistinct ? "yes" : "NO") : "-",
    s.races ? `${s.spreadMs.toFixed(2)} ms` : "-",
    s.failures.length ? "FAIL" : "PASS",
  ]);
  const width = head.map((h, k) => Math.max(h.length, ...rows.map((r) => r[k].length)));
  const fmt = (r) => r.map((v, k) => v.padEnd(width[k])).join("  ");
  console.log(`\n${fmt(head)}\n${width.map((w) => "-".repeat(w)).join("  ")}`);
  results.forEach((s, i) => {
    console.log(fmt(rows[i]));
    for (const n of s.notes) console.log(`   ${n}`);
    for (const f of s.failures) console.log(`   FAIL: ${f}`);
  });
}

let exitCode = 1;
const started = Date.now();
try {
  console.log(`test:pg — ${found.version} from ${found.dir}`);
  c = await startCluster(found.dir);
  const [version, isolation, listen] = (await sql(c, "SELECT current_setting('server_version'), current_setting('transaction_isolation'), current_setting('listen_addresses')"))[0];
  console.log(`cluster: PostgreSQL ${version} on 127.0.0.1:${c.port} (listen_addresses=${listen}; pg_hba: trust 127.0.0.1/32 only), default isolation ${isolation}`);
  console.log(`temp dir (outside the repo): ${c.dir}`);
  const dbDir = fileURLToPath(new URL("../db/", import.meta.url));
  const { applied } = await applyMigrations(c, dbDir, sqlStatements);
  console.log(`migrations: ${applied.map((f) => `${f.file.slice(0, 3)}(${f.statements})`).join(" ")} = ${applied.length} files, ${applied.reduce((n, f) => n + f.statements, 0)} statements via db/statements.mjs`);
  const col = await scalar(c, "SELECT count(*) FROM information_schema.columns WHERE table_name = 'app_gw_deliveries' AND column_name = 'leased_until'");
  if (col !== "1") throw new Error("051_webhook_outbox.sql did not add app_gw_deliveries.leased_until");
  await sql(c, `INSERT INTO app_gw_webhooks (id, merchant, url, secret, created_at) VALUES ${HOOKS.map(([id, m]) => `(${lit(id)}, ${lit(m.toLowerCase())}, ${lit(`https://example.com/${id}`)}, 'fixture-not-a-secret', ${T0})`).join(", ")}`);
  console.log(`statements under test (imported from lib/server/webhooks.ts): ${NAMES.join(", ")}`);
  console.log(`each race: ${WORKERS} psql processes (own connection each), released together by an advisory-lock gate; ${ROUNDS} races per scenario`);

  const results = [];
  for (const run of [enqueueOnce, claimLease, mixedClaims, fencedOutcome, dispatchClaims]) {
    process.stdout.write(`running ${run.name} ... `);
    const s = await run();
    console.log(s.failures.length ? "FAIL" : "ok");
    results.push(s);
  }
  process.stdout.write("running reapply ... ");
  const re = await reapply(dbDir);
  console.log(re.failures.length ? "FAIL" : "ok");
  results.push(re);
  printTable(results);
  const failed = results.filter((s) => s.failures.length).length;
  exitCode = failed ? 1 : 0;
  console.log(`\n${failed ? `FAIL: ${failed} of ${results.length} scenarios failed` : `PASS: ${results.length} scenarios`} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
} catch (err) {
  console.error(`\nERROR (harness): ${err instanceof Error ? err.message : String(err)}`);
  exitCode = 1;
} finally {
  const report = stopCluster();
  if (report) console.log(`cleanup: cluster ${report.stopped ? "stopped" : "NOT STOPPED"}, temp dir ${report.removed ? "removed" : `NOT REMOVED: ${report.dir}`}`);
  if (report && (!report.stopped || !report.removed)) exitCode = 1;
}
process.exitCode = exitCode;
