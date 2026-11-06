// Reports (FR-GW-9) in the dashboard Shell. Behind sign-in; read on our server from the gateway with the merchant's own
// sign-in cookie. The range is checked here before any call: India days, from on or before to, at most 92 days.
import { connection } from "next/server";
import { headers } from "next/headers";
import { Suspense } from "react";
import { Account, EditorialHeader, Problem, SignedOut } from "@/components/gateway/Frame";
import { RangeForm, ReportView } from "@/components/gateway/Reports";
import { Shell } from "@/components/dashboard/Shell";
import { authSecret } from "@/lib/auth";
import { errorText } from "@/lib/gateway-client";
import { moneyClient, reportRange } from "@/lib/gateway-money";
import { transportFor } from "@/lib/gateway-server";
import { currentMerchant } from "@/lib/merchant-session";

const header = (
  <EditorialHeader label="Reports" lede="Gross, fees, net and refunds for up to 92 days at a time, read from each payment's transaction. Download the same payments as a CSV for your accountant.">
    What came in, <span className="emphasis">day by day.</span>
  </EditorialHeader>
);

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default function ReportsPage({ searchParams }: PageProps<"/merchant/reports">) {
  return (
    <Suspense
      fallback={
        <Shell active="reports">
          {header}
          <p className="px-4 py-6 text-ink-muted md:px-8">Loading your report…</p>
        </Shell>
      }
    >
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

async function Reports({ searchParams }: Pick<PageProps<"/merchant/reports">, "searchParams">) {
  await connection(); // live data on every request, never a build-time snapshot
  const merchant = await currentMerchant();
  if (!merchant) return <SignedOut available={Boolean(authSecret())} />;
  const query = await searchParams;
  const typed = { from: one(query.from), to: one(query.to) };
  const range = reportRange(typed.from, typed.to);
  const result = range.ok
    ? await moneyClient(transportFor(await headers()))
        .report(range.value)
        .then(
          (report) => ({ report }),
          (error: unknown) => ({ error: errorText(error) }),
        )
    : null;
  return (
    <Shell active="reports" account={<Account merchant={merchant} />}>
      {header}
      <div className="grid gap-6 px-4 py-6 md:px-8 md:py-8">
        <RangeForm
          action="/merchant/reports"
          value={range.ok ? range.value : typed}
          error={range.ok ? undefined : range.error}
          csv={range.ok && result && "report" in result ? range.value : undefined} // the CSV link once the same range has loaded
        />

        {result && ("error" in result ? <Problem>{result.error}</Problem> : <ReportView report={result.report} />)}
      </div>
    </Shell>
  );
}
