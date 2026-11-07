// /sign-in: business sign-in (batch 050, SRS FR-BIZ-6 v3.1). The only page that loads Privy; next.config.ts gives it
// Privy's CSP and every other page keeps its own (test/csp-privy-scope.test.mjs). Customers never need this page.
import { PlainPage, Problem, card } from "@/components/gateway/Frame";
import { PrivySignIn } from "@/components/workspace/PrivySignIn";
import { privyAppId, walletConnectProjectId } from "@/lib/privy-config";

export const metadata = { title: "Sign in · Whiteflow" };

export default function SignInPage() {
  const appId = privyAppId();
  return (
    <PlainPage>
      <section aria-labelledby="signin-heading" className={`${card} mx-auto mt-10 max-w-lg`}>
        <h1 id="signin-heading" className="title">
          Sign in to your workspace
        </h1>
        <p className="text-sm text-ink-muted">
          Use your email or an existing wallet. Your sign-in is separate from the wallet that receives payments: you prove that
          wallet with its own signature in Settings.
        </p>
        {appId ? (
          <PrivySignIn appId={appId} wcProjectId={walletConnectProjectId()} />
        ) : (
          <Problem>Sign-in isn&apos;t set up on this server yet: the Privy app id is missing. Nothing else is affected.</Problem>
        )}
        <p className="text-xs text-ink-muted">
          Sign-in is provided by Privy, which receives the email or wallet address you sign in with and sends its own anonymous
          usage analytics. Only this page loads Privy; the Whiteflow dashboard, checkout and receipts don&apos;t. To approve
          where your workspace is paid, sign in with a wallet or link one in the Privy dialog.
        </p>
      </section>
    </PlainPage>
  );
}
