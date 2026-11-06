// Home sections 01–06 and the ghost footer (gateway v2 design). Server components with CSS-only motion; the orb,
// the "$" poster, the stat reveal and the quote's lock timer are the only islands.
// Code samples use the real SDK names from /docs, not the design's placeholders.
import { buttonClasses } from "@/components/Button";
import { mulberry32 } from "@/lib/dither";
import { Glyph } from "./Glyph";
import { LockTimer, RevealOnView } from "./Live";
import { Orb } from "./Orb";

/** A stand-in QR (not scannable), drawn as SVG at build time: 25 modules, three finder eyes, the blue centre. */
function qrPath(): string {
  const n = 25, r = mulberry32(11), eye = (a: number, b: number) => `M${a} ${b}h7v7h-7zM${a + 1} ${b + 1}h5v5h-5zM${a + 2} ${b + 2}h3v3h-3z`;
  let d = eye(0, 0) + eye(18, 0) + eye(0, 18);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (r() < 0.45 && !((i < 8 && j < 8) || (i > 16 && j < 8) || (i < 8 && j > 16))) d += `M${i} ${j}h1v1h-1z`;
    }
  }
  return d;
}
const QR_PATH = qrPath();

export function Accept() {
  return (
    <section className="lp-ed" id="accept">
      <div className="wrap">
        <div className="lp-ed-head">
          <span className="mono">01 / Accept</span>
          <h2 className="mask">
            Four ways to take a payment. <span className="em">None</span> need a developer.
          </h2>
        </div>
        <div className="lp-spec">
          <div className="rv">
            <span className="n" aria-hidden="true">01</span>
            <h3>Payment links</h3>
            <p>An amount, a currency, a link. Send it in a chat; it works once or every time.</p>
            <div className="obj">
              <div className="lp-linkpill">
                <span>pay.mc/l/cold-brew</span>
                <span className="copy" aria-hidden="true">
                  Copy
                </span>
              </div>
            </div>
          </div>
          <div className="rv">
            <span className="n" aria-hidden="true">02</span>
            <h3>Payment pages</h3>
            <p>Your logo, your colour, your items. A shop page without a shop.</p>
            <div className="obj lp-minipage">
              <div className="bar" />
              <div className="in">
                <b>Bandra Beans</b>
                <span className="num muted">Cold brew · 5.00 &nbsp; Croissant · 3.50</span>
              </div>
            </div>
          </div>
          <div className="rv">
            <span className="n" aria-hidden="true">03</span>
            <h3>QR at the counter</h3>
            <p>Every link and page prints as a QR. Customers scan, hold, done.</p>
            <div className="obj lp-qr">
              <svg viewBox="0 0 25 25" shapeRendering="crispEdges" role="img" aria-label="Example QR code">
                <path d={QR_PATH} fill="currentColor" fillRule="evenodd" />
                <rect x="10" y="10" width="5" height="5" fill="var(--scene-dot)" />
              </svg>
            </div>
          </div>
          <div className="rv">
            <span className="n" aria-hidden="true">04</span>
            <h3>A one-line button</h3>
            <p>Paste one tag into any site. It opens the same hosted checkout.</p>
            <div className="obj">
              <pre className="code">
                <span className="k">&lt;script</span> src=<span className="s">&quot;…/v1/button.js&quot;</span>
                {"\n  "}data-link=<span className="s">&quot;cold-brew&quot;</span>
                <span className="k">&gt;&lt;/script&gt;</span>
              </pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const STATS = [
  ["1.4 s", "median time to settle"],
  ["0", "gas paid by customers"],
  ["T+0", "to your wallet"],
  ["0.10", "USDT flat fee per payment"],
] as const;

export function Settle() {
  return (
    <section className="lp-dark" id="settle" aria-label="Settlement">
      <div className="wrap">
        <div>
          <span className="mono label">02 / Settle</span>
          <h2 className="mask">
            Settled before the <span className="em">receipt</span> prints.
          </h2>
          <p className="lede">
            The payment, the 0.10 USDT fee and your share move in one transaction. No payout schedule, no batch at midnight: T+0, every time.
          </p>
        </div>
        <Orb />
        <div className="lp-stats">
          {STATS.map(([value, label]) => (
            <div className="rv" key={label}>
              <b className="num">
                <RevealOnView text={value} />
              </b>
              <span className="mono">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Grow() {
  return (
    <section className="lp-ed" id="grow">
      <div className="wrap">
        <div className="lp-ed-head">
          <span className="mono">03 / Sell more</span>
          <h2 className="mask">
            Price in <span className="em">their</span> currency. Reward with a code.
          </h2>
        </div>
        <div className="lp-objs">
          <div className="rv">
            <div className="lp-ticket" role="img" aria-label="Discount voucher SAVE10: 10% off any order, ends 30 Nov, 41 of 100 left">
              <div className="l">
                <span className="mono soft">Bandra Beans · voucher</span>
                <span className="vcode">SAVE10</span>
                <span className="soft">10% off any order · ends 30 Nov</span>
              </div>
              <div className="r">
                <b className="num left">41</b>
                <span className="mono soft">of 100 left</span>
              </div>
            </div>
            <p className="mono note">Each code is an entity on Arkiv that expires with it</p>
          </div>
          <div className="rv">
            <div className="lp-quote">
              <span className="mono muted">Quote · locked for this checkout</span>
              <div className="big num">
                20.00 <span className="mono">EUR</span> <span className="muted">→</span> 22.51 <span className="mono">USDT</span>
              </div>
              <div className="lp-lock">
                <span className="num">1 EUR = 1.1235 USD · 1 USDT = 1 USD</span>
                <LockTimer />
              </div>
            </div>
            <p className="mono note">USD · EUR · GBP · INR · AED · SGD</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Poster() {
  return (
    <section className="lp-poster" aria-label="Every payment, on the record">
      <span className="circ a" aria-hidden="true" />
      <span className="circ b" aria-hidden="true" />
      <div className="wrap">
        <Glyph />
        <div>
          <span className="mono label">04 / Know your numbers</span>
          <h2 className="mask">
            Every payment,
            <br />
            on the <span className="em">record.</span>
          </h2>
          <p>Reports, settlements and refunds read straight from the chain. Export a CSV for your accountant that matches it to the cent.</p>
        </div>
      </div>
    </section>
  );
}

export function Developers() {
  return (
    <section className="lp-ed" id="dev">
      <div className="wrap">
        <div className="lp-ed-head">
          <span className="mono">05 / Developers</span>
          <h2 className="mask">
            Three steps. <span className="em">Test keys</span> in a minute.
          </h2>
        </div>
        <div className="lp-steps">
          <div className="rv">
            <span className="mono muted">Step 1 · Button</span>
            <pre className="code">
              <span className="k">&lt;script</span> src=<span className="s">&quot;…/v1/button.js&quot;</span>
              {"\n  "}data-session=<span className="s">&quot;SESSION_ID&quot;</span>
              <span className="k">&gt;&lt;/script&gt;</span>
            </pre>
          </div>
          <div className="rv">
            <span className="mono muted">Step 2 · Server</span>
            <pre className="code">
              <span className="k">const</span> s = <span className="k">await</span> gateway.sessions.create{"({"}
              {"\n  "}amount: <span className="s">&quot;20.00&quot;</span>, currency: <span className="s">&quot;EUR&quot;</span>,
              {"\n  "}returnUrl: <span className="s">&quot;https://shop.example&quot;</span> {"})"}
            </pre>
          </div>
          <div className="rv">
            <span className="mono muted">Step 3 · Webhook</span>
            <pre className="code">
              <span className="k">const</span> event = constructEvent(body,
              {"\n  "}req.headers.get(SIGNATURE_HEADER), secret)
              {"\n"}
              <span className="k">if</span> (event.type === <span className="s">&quot;payment.succeeded&quot;</span>)
              {"\n  "}fulfil(order)
            </pre>
          </div>
        </div>
        <div className="lp-steps-foot">
          <a className={buttonClasses("quiet")} href="/docs">
            Read the developer docs
          </a>
        </div>
      </div>
    </section>
  );
}

export function Capital() {
  return (
    <section className="lp-ed" id="capital">
      <div className="wrap lp-capital">
        <div>
          <span className="mono muted">06 / Capital</span>
          <h2 className="mask">
            Get paid <span className="em">early,</span> repay from sales.
          </h2>
          <p>An advance funded by investors, repaid with a share of each sale in the same transaction. You see the full cost before you sign.</p>
        </div>
        <div className="lp-offer rv">
          <div className="head">
            <span className="mono muted">Offer · revenue advance</span>
            <span className="tag">Open</span>
          </div>
          <div className="big num">
            1,000.00 <span className="mono muted">USDT now</span>
          </div>
          <div className="num muted">Repay 1,100.00 · 20% of each sale · cost 100.00</div>
          <div className="lp-bar" aria-hidden="true">
            <i />
          </div>
          <div className="mono num muted">640.00 of 1,000.00 funded · 2 investors</div>
        </div>
      </div>
    </section>
  );
}

const footLink = "inline-flex min-h-11 items-center";

export function Footer() {
  return (
    <footer className="lp-foot">
      <div className="wrap">
        <div className="cols">
          <span className={footLink}>Built for ETHGlobal Mumbai</span>
          <span className={footLink}>Whitechain testnet only</span>
          <a className={footLink} href="/docs">
            Docs
          </a>
          <a className={footLink} href="/merchant">
            Dashboard
          </a>
          <a className={footLink} href="/proofs">
            Private reads and wallet proofs
          </a>
        </div>
        <div className="ghost" aria-hidden="true">
          Merchant Capital+
        </div>
      </div>
    </footer>
  );
}
