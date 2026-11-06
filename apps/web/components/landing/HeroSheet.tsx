"use client";

// The hero's tilted checkout sheet: the real hold-to-pay button (same 900 ms hold, release cancels, a keyboard press
// confirms at once) driving a demo. Nothing is charged; finishing the hold just shows the "settled" chip.
import { useEffect, useRef, useState } from "react";
import { HoldButton } from "@/components/HoldButton";

const CONFIRM_MS = 500;
const CHIP_MS = 3200;

export function HeroSheet() {
  const [settled, setSettled] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const pay = () =>
    new Promise<void>((resolve) => {
      timer.current = setTimeout(() => {
        resolve();
        setSettled(true);
        timer.current = setTimeout(() => setSettled(false), CHIP_MS);
      }, CONFIRM_MS);
    });

  return (
    <div className="lp-sheet-wrap">
      <div className="lp-sheet">
        <div className="mono muted">Order BB-1042</div>
        <div className="shop">Bandra Beans</div>
        <div className="row">
          <span>2 × Cold brew</span>
          <span className="num">10.00</span>
        </div>
        <div className="row">
          <span>1 × Banana bread</span>
          <span className="num">5.00</span>
        </div>
        <div className="lp-fxline num">
          <span>20.00 EUR → 22.51 USDT</span>
          <span>rate of 6 Nov</span>
        </div>
        <div className="total">
          <span className="mono muted">Total</span>
          <span>
            <span className="amt num">22.51</span> <span className="mono muted">USDT</span>
          </span>
        </div>
        <HoldButton
          label="Hold to pay 22.51"
          busyLabel="Paying"
          doneLabel="Paid"
          onConfirm={pay}
          className="w-full"
          aria-describedby="lp-sheet-note"
        />
        <p className="fine">You pay exactly 22.51 USDT. No fees for you.</p>
        <p id="lp-sheet-note" className="sr-only">
          A demo: nothing is charged.
        </p>
      </div>
      <div className={settled ? "lp-chip" : "lp-chip off"} aria-hidden="true">
        <span className="dot" />
        <span>
          <b className="num">Settled in 1.4 s</b> · 0 gas
        </span>
      </div>
      <p className="sr-only" role="status">
        {settled ? "Paid. Settled in 1.4 seconds, no gas." : ""}
      </p>
    </div>
  );
}
