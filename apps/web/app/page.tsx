// Home: the approved "Mercury + dither" hero (design-refs/merchant-capital-demo.html), with the two ways in:
// pay as a customer, or open the shop's dashboard.
import Link from "next/link";
import { Button, buttonClasses } from "@/components/Button";
import { DitherScene } from "@/components/DitherScene";

const steps = [
  { title: "A customer pays", body: "One hold on the pay page. No app to install, no fees, nothing to set up." },
  { title: "Part of each sale repays your advance", body: "20% of every sale goes to the investors who funded your cash, inside the same payment." },
  { title: "The advance closes itself", body: "Once 110.00 is repaid the share stops, and every sale is yours again." },
];

export default function Home() {
  return (
    <main>
      <section className="relative overflow-hidden bg-scene-night text-glass-ink">
        <DitherScene />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-linear-to-r from-scene-night from-25% via-scene-night/70 via-50% to-transparent to-75%" />
        <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-28">
          <header className="flex items-center justify-between gap-4">
            <span className="title whitespace-nowrap">Merchant Capital+</span>
            <nav className="flex items-center gap-1 text-sm">
              <Link href="/merchant" className={buttonClasses("glass", "h-10 px-4 text-sm")}>
                Dashboard
              </Link>
            </nav>
          </header>
          <p className="label mt-24 opacity-75">For cafés and shops in Mumbai</p>
          <h1 className="display-xl mt-3 max-w-2xl text-balance">
            Get paid today.
            <br />
            Repay from your <span className="emphasis">sales</span>.
          </h1>
          <p className="mt-4 max-w-md opacity-85">
            Customers pay in USDT with one hold and no fees to them. Shops raise cash now, and 20% of each sale repays it automatically until
            it&apos;s done.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <form method="post" action="/api/demo-checkout">
              <Button type="submit">Try a checkout</Button>
            </form>
            <Link href="/merchant" className={buttonClasses("glass")}>
              Open the dashboard
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="how">
        <h2 id="how" className="display">
          How it works
        </h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-3">
          {steps.map((step, i) => (
            <li key={step.title} className="grid content-start gap-3 rounded-md border border-hairline bg-surface p-6 shadow-card">
              <span className="data text-accent">0{i + 1}</span>
              <h3 className="title">{step.title}</h3>
              <p className="text-ink-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 border-t border-hairline px-4 py-8 text-sm text-ink-muted">
        <span>Testnet demo on Whitechain Sepolia. Test USDT only.</span>
        <Link href="/proofs" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-ink">
          Private reads and wallet proofs
        </Link>
      </footer>
    </main>
  );
}
