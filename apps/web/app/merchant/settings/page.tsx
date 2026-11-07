// Whiteflow Workspace Settings (/merchant/settings):
// Workspace profile, receiving-wallet policies, network configuration, and honest permissions disclosures.
import { connection } from "next/server";
import { Suspense } from "react";
import { CopyButton } from "@/components/CopyButton";
import { Shell } from "@/components/dashboard/Shell";
import { Account, EditorialHeader } from "@/components/gateway/Frame";
import { StatusBadge } from "@/components/ui/Badge";
import { LegacyAccess } from "@/components/workspace/LegacyAccess";
import { WorkspaceSettings } from "@/components/workspace/WorkspaceSettings";
import { merchantConfig, payConfig } from "@/lib/config";
import { currentMerchant } from "@/lib/merchant-session";
import { relayerHealth } from "@/lib/relay";
import { EXPLORER } from "@/lib/usdt";

const header = (
  <EditorialHeader
    label="Settings"
    lede="Workspace preferences, receiving-wallet policy, and network parameters."
  >
    Workspace &amp; <span className="emphasis">settlement policy.</span>
  </EditorialHeader>
);

function wbt(value: string | null): string {
  const n = value === null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(n) ? `${n.toFixed(4)} WBT` : "—";
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <Shell active="settings" privateReads={false}>
          {header}
          <p className="px-4 py-8 text-ink-muted md:px-8">Loading settings…</p>
        </Shell>
      }
    >
      <SettingsLoader />
    </Suspense>
  );
}

async function SettingsLoader() {
  await connection();
  const merchant = await currentMerchant();
  // the Whiteflow workspace (Privy sign-in, team, receiving wallet) shows whether or not a merchant wallet is linked;
  // without a linked wallet, the link step (batch 051) sits right under it
  if (!merchant) {
    return (
      <Shell active="settings" privateReads={false}>
        {header}
        <div className="grid max-w-4xl gap-8 px-4 py-6 md:px-8 md:py-8">
          <WorkspaceSettings />
          <section aria-labelledby="link-heading" className="grid gap-3 rounded-[16px] border border-hairline bg-surface p-5 md:p-6 shadow-card">
            <h2 id="link-heading" className="text-[17px] font-semibold text-ink">Link your existing merchant wallet</h2>
            <p className="text-xs text-ink-muted">If you used the merchant dashboard with a wallet before, link it once: its links, keys and payments come with it.</p>
            <LegacyAccess />
          </section>
        </div>
      </Shell>
    );
  }

  const config = merchantConfig();
  const pay = payConfig();
  const health = pay ? await relayerHealth(pay.relayerUrl) : null;

  const receivingWallet = config?.merchant ?? merchant;
  const isDesignatedWallet = merchant.toLowerCase() === receivingWallet.toLowerCase();

  return (
    <Shell active="settings" privateReads={false} account={<Account merchant={merchant} />}>
      {header}
      <div className="grid gap-8 px-4 py-6 md:px-8 md:py-8 max-w-4xl">
        <WorkspaceSettings />
        {/* Workspace Identity & Session */}
        <section aria-labelledby="profile-heading" className="grid gap-5 rounded-[16px] border border-hairline bg-surface p-5 md:p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
            <div>
              <h2 id="profile-heading" className="text-[17px] font-semibold text-ink">
                Workspace Identity
              </h2>
              <p className="text-xs text-ink-muted">
                Active business profile and session authorization.
              </p>
            </div>
            <StatusBadge status="paid" label="Active Session" />
          </div>

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="grid gap-1">
              <dt className="eyebrow text-ink-muted">Business Name</dt>
              <dd className="font-medium text-ink">{config?.merchantName ?? "Whiteflow Business"}</dd>
            </div>
            <div className="grid gap-1">
              <dt className="eyebrow text-ink-muted">Display Timezone</dt>
              <dd className="font-mono text-ink">Asia/Kolkata (IST · UTC+05:30)</dd>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <dt className="eyebrow text-ink-muted">Linked merchant wallet</dt>
              <dd className="flex items-center gap-2 font-mono text-xs text-ink bg-surface-sunk/60 p-2.5 rounded-[8px] border border-hairline break-all">
                <span>{merchant}</span>
                <CopyButton text={merchant} name="linked merchant wallet" label="Copy" />
              </dd>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <dt className="eyebrow text-ink-muted">Sign-in</dt>
              <dd className="text-xs text-ink-muted leading-relaxed">
                Whiteflow sign-in (Privy: email or wallet) with roles per workspace. This workspace manages the merchant wallet above; changing where it is paid
                needs an approval wallet. Sign out from the Workspace section or the account menu.
              </dd>
            </div>
          </dl>
        </section>

        {/* Receiving Wallet & Settlement Policy */}
        <section aria-labelledby="policy-heading" className="grid gap-5 rounded-[16px] border border-hairline bg-surface p-5 md:p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
            <div>
              <h2 id="policy-heading" className="text-[17px] font-semibold text-ink">
                Receiving Wallet &amp; Settlement Policy
              </h2>
              <p className="text-xs text-ink-muted">
                Destination where customer payments settle atomically in USDT.
              </p>
            </div>
            <StatusBadge status="open" label="Policy v1.0 (Locked)" />
          </div>

          <div className="grid gap-4 text-sm">
            <div className="grid gap-1.5">
              <span className="eyebrow text-ink-muted">Designated Receiving Address</span>
              <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-sunk/60 p-3 rounded-[8px] border border-hairline">
                <span className="font-mono text-xs text-ink break-all">{receivingWallet}</span>
                <div className="flex items-center gap-3">
                  <CopyButton text={receivingWallet} name="receiving wallet address" label="Copy" />
                  <a
                    href={`${EXPLORER}/address/${receivingWallet}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-accent underline underline-offset-4"
                  >
                    Explorer ↗
                  </a>
                </div>
              </div>
              {!isDesignatedWallet && (
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Your current session ({merchant.slice(0, 6)}…{merchant.slice(-4)}) differs from the designated receiver ({receivingWallet.slice(0, 6)}…{receivingWallet.slice(-4)}). Payment links settle to the generating wallet; invoices settle to the designated receiver.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-hairline pt-4 sm:grid-cols-3">
              <div>
                <span className="eyebrow text-ink-muted">Settlement Token</span>
                <p className="mt-1 font-semibold text-ink">USDT</p>
              </div>
              <div>
                <span className="eyebrow text-ink-muted">Settlement Rail</span>
                <p className="mt-1 font-semibold text-ink">Whitechain (T+0)</p>
              </div>
              <div>
                <span className="eyebrow text-ink-muted">Sponsor Gas</span>
                <p className="mt-1 font-semibold text-positive">Sponsored (Relayer)</p>
              </div>
            </div>

            <div className="rounded-[10px] bg-surface-sunk/50 p-4 border border-hairline text-xs text-ink-muted leading-relaxed">
              <p className="font-medium text-ink mb-1">Immutable Invoice Binding</p>
              Receiving policies are version-locked. Existing invoices remain permanently bound to the receiving address at time of creation. Changing receiving configuration requires step-up authentication and fresh cryptographic proof of control.
            </div>
          </div>
        </section>

        {/* Network & Infrastructure Telemetry */}
        <section aria-labelledby="network-heading" className="grid gap-5 rounded-[16px] border border-hairline bg-surface p-5 md:p-6 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline pb-4">
            <div>
              <h2 id="network-heading" className="text-[17px] font-semibold text-ink">
                Network &amp; Relayer Infrastructure
              </h2>
              <p className="text-xs text-ink-muted">
                Whitechain Sepolia testnet parameters and sponsored gas health.
              </p>
            </div>
            <StatusBadge
              status={health && !health.paused ? "paid" : "warning"}
              label={health && !health.paused ? "Relayer Healthy" : "Relayer Standby"}
            />
          </div>

          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="grid gap-1">
              <dt className="eyebrow text-ink-muted">Network</dt>
              <dd className="font-medium text-ink">Whitechain Sepolia Testnet (Chain ID 1874)</dd>
            </div>
            <div className="grid gap-1">
              <dt className="eyebrow text-ink-muted">Official RPC</dt>
              <dd className="font-mono text-xs text-ink">https://rpc.testnet.whitechain.io</dd>
            </div>
            <div className="grid gap-1 sm:col-span-2">
              <dt className="eyebrow text-ink-muted">MerchantPay Contract</dt>
              <dd className="font-mono text-xs text-ink flex items-center gap-2">
                <span>{pay?.merchantPay ?? "Not configured"}</span>
                {pay?.merchantPay && <CopyButton text={pay.merchantPay} name="MerchantPay address" label="Copy" />}
              </dd>
            </div>
            {health && (
              <>
                <div className="grid gap-1">
                  <dt className="eyebrow text-ink-muted">Relayer Balance</dt>
                  <dd className="font-mono text-xs text-ink">{wbt(health.wbt)}</dd>
                </div>
                <div className="grid gap-1">
                  <dt className="eyebrow text-ink-muted">Daily Gas Budget Left</dt>
                  <dd className="font-mono text-xs text-ink">{wbt(health.budgetLeft)}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

      </div>
    </Shell>
  );
}
