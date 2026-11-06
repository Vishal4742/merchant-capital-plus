// Home: the approved "gateway v2" landing (design-refs/gateway-v2-demo.html). Server-rendered and static; only the
// canvas scenes, the hero's hold demo and a few live numbers hydrate. The root layout already shows the test-mode strip.
import "@/components/landing/landing.css";
import { Hero, Nav, Ticker } from "@/components/landing/Hero";
import { Accept, Capital, Developers, Footer, Grow, Poster, Settle } from "@/components/landing/Sections";

export default function Home() {
  return (
    <div className="lp">
      <Nav />
      <main>
        <Hero />
        <Ticker />
        <Accept />
        <Settle />
        <Grow />
        <Poster />
        <Developers />
        <Capital />
      </main>
      <Footer />
    </div>
  );
}
