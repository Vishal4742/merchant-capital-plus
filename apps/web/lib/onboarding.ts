// The merchant onboarding (batch 024): the network a wallet is asked to add, the dashboard home's "Get started" steps,
// and the plain sentences a failed sign-in shows. Pure, no server or browser imports: the sign-in steps (browser) and
// the home (server) share it, and node:test covers it.

/** EIP-3085 wallet_addEthereumChain for chain 1874: viem's whitechainSepolia (id, coin, RPC, explorer), plus the Ankr
 *  endpoint our own reads use (ARCHITECTURE §RPC), so the wallet has a second RPC. */
export const WHITECHAIN_TESTNET = {
  chainId: "0x752",
  chainName: "Whitechain Testnet",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.whitechain.io", "https://rpc.ankr.com/whitechain_testnet"],
  blockExplorerUrls: ["https://explorer.testnet.whitechain.io"],
};

/** How long a sign-in may take, from the nonce to the answer: the SIWE message expires then, as does the nonce cookie. */
export const SIGN_IN_WINDOW_MS = 5 * 60_000;

export type StepStatus = "done" | "todo" | "unknown";

export interface SetupStep {
  title: string;
  text: string;
  status: StepStatus;
  actions: { href: string; label: string }[];
}

export interface SetupFacts {
  /** null: couldn't be read right now */
  links: number | null;
  keys: number | null;
  payments: number;
  /** The newest active link's hosted page, for "pay it yourself"; null when there is none. */
  payHref: string | null;
}

const statusOf = (n: number | null): StepStatus => (n === null ? "unknown" : n > 0 ? "done" : "todo");

/** The four steps from a new wallet to a site that takes payments, each with what it needs and where to do it. */
export function setupSteps(facts: SetupFacts): SetupStep[] {
  const linked = statusOf(facts.links);
  return [
    {
      title: "Create a payment link",
      text: "Set a price, or let the customer type one in. It takes a minute.",
      status: linked,
      actions: [{ href: "/merchant/links", label: "Create a link" }],
    },
    {
      title: "Share it",
      text: "Copy the link into a chat, or show its QR code at the counter.",
      status: linked,
      actions: [{ href: "/merchant/links", label: "Copy or show the QR" }],
    },
    {
      title: "Get your first payment",
      text: "Open your link and pay it with test USDT. Test USDT: ask the team during the hackathon.",
      status: statusOf(facts.payments),
      actions: [facts.payHref ? { href: facts.payHref, label: "Open your link" } : { href: "/merchant/links", label: "Create a link first" }],
    },
    {
      title: "Add the gateway to your site",
      text: "A checkout button or a few lines of server code. Your API keys and webhooks are under Developers.",
      status: statusOf(facts.keys),
      actions: [
        { href: "/docs", label: "Read the docs" },
        { href: "/merchant/developers", label: "API keys and webhooks" },
      ],
    },
  ];
}

export const doneCount = (steps: SetupStep[]) => steps.filter((step) => step.status === "done").length;

const USER_REJECTED = 4001; // EIP-1193
const REQUEST_PENDING = -32002; // MetaMask: a request of this kind is already open

/** A wallet error as one plain sentence. `what`: adding the network, or signing in. */
export function walletProblem(error: unknown, what: "network" | "sign"): string {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === USER_REJECTED) return what === "sign" ? "You cancelled in your wallet. Nothing was signed." : "You cancelled in your wallet. Nothing changed.";
  if (code === REQUEST_PENDING) return "Your wallet already has a request open. Open the wallet, finish or close it, then try again.";
  return what === "sign"
    ? "Sign-in didn't work. Try again."
    : "Your wallet couldn't add the network. Add it by hand instead: chain ID 1874, RPC https://rpc.testnet.whitechain.io.";
}

/** A non-OK answer from /api/auth/nonce or /api/auth/verify, `elapsedMs` after the nonce was asked for. */
export function signInProblem(status: number, serverError: string | undefined, elapsedMs: number): string {
  if (status === 401 && elapsedMs >= SIGN_IN_WINDOW_MS) return "That took too long. Try again.";
  if (status === 503) return "Sign-in is down on our side for a moment. Nothing was charged. Try again in a minute.";
  return status === 401 && serverError ? serverError : "Sign-in didn't work. Try again.";
}
