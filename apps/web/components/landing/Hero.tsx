// Home hero (gateway v2 design): nav, the dithered Marine Drive night, headline, CTAs, the tilted checkout sheet,
// mono corners, then the FX ticker. Server-rendered; the scene, the sheet's hold demo and the clock are islands.
// Links to /merchant and /docs are plain <a>: a full load, so those pages run under their own CSP (security review
// 005 F-N4), and no prefetch pulls their JS into the home page.
import { Button, buttonClasses } from "@/components/Button";
import { HeroScene } from "./HeroScene";
import { HeroSheet } from "./HeroSheet";
import { IstClock } from "./Live";
import { WhiteFlowMark } from "@/components/WhiteFlowMark";

export function Nav() {
  return (
    <header className="lp-nav">
      <div className="wrap">
        <span className="lp-word inline-flex items-center gap-2">
          <WhiteFlowMark />
          WhiteFlow
        </span>
        <nav className="links" aria-label="Product">
          <a href="#accept">Invoices &amp; Payments</a>
          <a href="#settle">Settlement</a>
          <a href="#grow">Vouchers &amp; FX</a>
          <a href="#dev">Developers</a>
          <a href="#capital">Advances</a>
        </nav>
        <div className="right">
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
      <div className="lp-corner tl mono" aria-hidden="true">
        18.94° N · 72.82° E
        <br />
        Marine Drive, Mumbai
      </div>
      <div className="lp-corner tr mono" aria-hidden="true">
        Whitechain testnet
        <br />
        <IstClock /> IST
      </div>
      <div className="lp-corner br mono" aria-hidden="true">
        Fig. 01 — Atomic settlement
      </div>
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

const RATES = [
  ["USD", "1.0000"],
  ["EUR", "1.1235"],
  ["GBP", "1.3472"],
  ["INR", "0.0106"],
  ["AED", "0.2723"],
  ["SGD", "0.7828"],
] as const;

function Rates() {
  return (
    <>
      {RATES.map(([code, rate]) => (
        <span key={code}>
          1 {code} <b className="num">{rate}</b> USDT
        </span>
      ))}
      <span>rates of 5 Nov · display and quote only</span>
    </>
  );
}

/** Scrolls by in CSS; the second copy makes the loop seamless and is hidden from screen readers. */
export function Ticker() {
  return (
    <section className="lp-ticker" aria-label="Exchange rates shown at checkout">
      <div className="track mono">
        <span>
          <Rates />
        </span>
        <span aria-hidden="true">
          <Rates />
        </span>
      </div>
    </section>
  );
}
