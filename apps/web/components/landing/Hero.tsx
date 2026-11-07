// Home hero (gateway v2 design): nav, the dithered Marine Drive night, headline, CTAs, the tilted checkout sheet,
// no corner labels or FX ticker (batch 061, the human's call). Server-rendered; the scene and the sheet's hold demo are islands.
// Links to /merchant and /docs are plain <a>: a full load, so those pages run under their own CSP (security review
// 005 F-N4), and no prefetch pulls their JS into the home page.
import { Button, buttonClasses } from "@/components/Button";
import { HeroScene } from "./HeroScene";
import { HeroSheet } from "./HeroSheet";
import { ThemeToggle } from "@/components/ThemeToggle";
import { WhiteFlowMark } from "@/components/WhiteFlowMark";

export function Nav() {
  return (
    <header className="lp-nav">
      <div className="wrap">
        <span className="lp-word inline-flex items-center gap-2">
          <WhiteflowMark />
          Whiteflow
        </span>
        <nav className="links" aria-label="Product">
          <a href="#accept">Invoices &amp; Payments</a>
          <a href="#settle">Settlement</a>
          <a href="#grow">Vouchers &amp; FX</a>
          <a href="#dev">Developers</a>
          <a href="#capital">Advances</a>
        </nav>
        <div className="right">
          <ThemeToggle className="border-glass-edge bg-glass-fill text-glass-ink backdrop-blur-[20px] hover:border-glass-ink" />
          <a className={buttonClasses("glass", "h-10! px-4! text-sm")} href="/merchant">
            Sign in
          </a>
          <a className={buttonClasses("primary", "h-10! px-4! text-sm max-sm:hidden")} href="/merchant">
            Open workspace
          </a>
        </div>
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section className="lp-hero" aria-label="Introduction">
      <HeroScene />
      <div className="wash" aria-hidden="true" />
      <div className="wrap">
        <div>
          <span className="mono kicker">Business Payments Workspace</span>
          <h1>
            One invoice.
            <br />
            <span className="em">Clear settlement.</span>
          </h1>
          <p className="lede">
            Request business payments, accept supported crypto, and settle exact USDT directly to your Whitechain wallet. Customers pay with zero gas friction on Whitechain testnet.
          </p>
          <div className="cta">
            <a className={buttonClasses("primary")} href="/merchant">
              Open workspace
            </a>
            {/* a plain form POST answered with 303: a full load, so the checkout runs under its own CSP */}
            <form method="post" action="/api/demo-checkout">
              <Button type="submit" variant="glass">
                Try a checkout
              </Button>
            </form>
          </div>
        </div>
        <HeroSheet />
      </div>
    </section>
  );
}
