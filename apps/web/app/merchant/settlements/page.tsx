// Settlements (FR-GW-10) in the dashboard Shell. Behind sign-in; our server reads the signed-in merchant's settlements
// from the gateway's own module (lib/server/settlements.ts), for the same India-day range as Reports (checked here first).
// On top, the USDT already in the merchant's wallet and the Withdraw form (FR-GW-15), read apart from the history so
// Withdraw still works when the log index is down.
import { isHex } from "viem";
import { readTxFee, readUsdtBalance } from "@/lib/onchain";
import { connection } from "next/server";
import { Suspense } from "react";
import { Account, EditorialHeader, Problem, SignedOut } from "@/components/gateway/Frame";
import { RangeForm } from "@/components/gateway/Reports";
import { SettlementsView } from "@/components/gateway/Settlements";
import { Shell } from "@/components/dashboard/Shell";
import { Withdraw } from "@/components/merchant/Withdraw";
import { authSecret } from "@/lib/auth";
import { reportRange, type Settlements } from "@/lib/gateway-money";
import { merchantSettlements, readFailure } from "@/lib/gateway-server";
import { currentMerchant } from "@/lib/merchant-session";

const header = (
  <EditorialHeader label="Settlements" lede="No payout schedule and nothing held back: each payment lands in your wallet in its own transaction, split with any investors on the way.">
    Settled before the <span className="emphasis">receipt prints.</span>
  </EditorialHeader>
);

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

const FEE_ROWS = 50; // ponytail: one receipt read per row; page or cache them if ranges grow

/** The network fee the relayer covered for each settlement's transaction (the newest FEE_ROWS), from its receipt. */
async function coveredFees(data: Settlements): Promise<Map<string, bigint | null>> {
  const hashes = data.settlements.map((s) => s.tx_hash).filter((h): h is `0x${string}` => typeof h === "string" && isHex(h)).slice(0, FEE_ROWS);
  return new Map(await Promise.all(hashes.map(async (h) => [h, await readTxFee(h).catch(() => null)] as const)));
}

export default function SettlementsPage({ searchParams }: PageProps<"/merchant/settlements">) {
  return (
    <Suspense
      fallback={
        <Shell active="settlements">
          {header}
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading your settlements…</p>
        </Shell>
      }
    >
      <SettlementsLoader searchParams={searchParams} />
    </Suspense>
  );
}

async function SettlementsLoader({ searchParams }: Pick<PageProps<"/merchant/settlements">, "searchParams">) {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const query = await searchParams;
  const typed = { from: one(query.from), to: one(query.to) };
  const range = reportRange(typed.from, typed.to);
  const [result, balance] = await Promise.all([
    range.ok
      ? merchantSettlements(merchant, range.value).then(
          (data) => ({ data }),
          (error: unknown) => ({ error: readFailure("Settlements", error) }),
        )
      : null,
    readUsdtBalance(merchant).then((units) => units.toString(), () => null),
  ]);
  return (
    <Shell active="settlements" account={<Account merchant={merchant} />}>
      {header}
      <div className="grid gap-6 px-4 py-6 md:px-8 md:py-8">
        <Withdraw merchant={merchant} balance={balance} />
        <RangeForm action="/merchant/settlements" value={range.ok ? range.value : typed} error={range.ok ? undefined : range.error} />
        {result && ("error" in result ? <Problem>{result.error}</Problem> : <SettlementsView data={result.data} fees={await coveredFees(result.data)} />)}
      </div>
    </Shell>
  );
}
