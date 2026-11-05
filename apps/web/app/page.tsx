"use client";

// Phase 1 rail proofs (DEP-6, DEP-3). Internal page; Phase 2 replaces it with the merchant dashboard.
import { useCallback, useEffect, useState } from "react";
import { TRANSPORT_LABEL, getChainClient } from "@/lib/anon";
import { proveTypedDataSigning } from "@/lib/guest-wallet";

type Proof =
  | { state: "running" }
  | { state: "ok"; detail: string; ms: number }
  | { state: "failed"; error: string };

const STILL_WORKING_AFTER_S = 60;

/** One plain line: viem's shortMessage when present, never the request body or URL. */
function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Unexpected error";
  const short = (error as { shortMessage?: unknown }).shortMessage;
  return (typeof short === "string" ? short : error.message).split("\n")[0];
}

function useProof(run: () => Promise<string>) {
  const [proof, setProof] = useState<Proof>({ state: "running" });
  const execute = useCallback(() => {
    const startedAt = performance.now();
    return run().then(
      (detail) => setProof({ state: "ok", detail, ms: performance.now() - startedAt }),
      (error: unknown) => setProof({ state: "failed", error: errorMessage(error) }),
    );
  }, [run]);
  useEffect(() => {
    void execute();
  }, [execute]);
  const retry = () => {
    setProof({ state: "running" });
    void execute();
  };
  return [proof, retry] as const;
}

const readBlock = async () => {
  const client = await getChainClient();
  const block = await client.getBlockNumber();
  return `Block ${block.toLocaleString("en-US")} on chain 1874, via ${TRANSPORT_LABEL}`;
};

const signProof = async () => {
  const { address, valid } = await proveTypedDataSigning();
  if (!valid) throw new Error("Signature did not verify");
  return `Guest wallet ${address.slice(0, 6)}…${address.slice(-4)} signed and verified typed data for chain 1874`;
};

/** Mounted only while a proof runs, so it restarts from 0 on every run. */
function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="font-mono tabular-nums text-black/60 dark:text-white/60" aria-hidden="true">
      {" "}({seconds} s{seconds >= STILL_WORKING_AFTER_S && " · still working"})
    </span>
  );
}

interface ProofCardProps {
  title: string;
  requirement: string;
  runningText: string;
  retryLabel: string;
  proof: Proof;
  onRetry: () => void;
}

function ProofCard({ title, requirement, runningText, retryLabel, proof, onRetry }: ProofCardProps) {
  return (
    <section className="rounded-lg border border-black/15 p-5 dark:border-white/20">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="font-mono text-xs text-black/60 dark:text-white/60">{requirement}</span>
      </div>
      <p className="mt-3 text-sm break-words">
        <span role="status" aria-live="polite">
          {proof.state === "running" && runningText}
          {proof.state === "ok" && (
            <>
              <span className="font-medium text-green-700 dark:text-green-400">OK</span> ·{" "}
              <span className="tabular-nums">{proof.detail}</span>
            </>
          )}
          {proof.state === "failed" && <span className="text-red-700 dark:text-red-400">Failed: {proof.error}</span>}
        </span>
        {proof.state === "running" && <Elapsed />}
        {proof.state === "ok" && proof.ms >= 1000 && (
          <span className="font-mono tabular-nums text-black/60 dark:text-white/60"> ({(proof.ms / 1000).toFixed(1)} s)</span>
        )}
      </p>
      <button
        type="button"
        // aria-disabled, not disabled: a disabled button drops keyboard focus to the body in Chromium.
        onClick={proof.state === "running" ? undefined : onRetry}
        aria-disabled={proof.state === "running"}
        className="mt-4 rounded-md border border-black/20 px-3 py-2 text-sm hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-white/30 dark:hover:bg-white/10 dark:focus-visible:outline-blue-400"
      >
        {retryLabel}
      </button>
    </section>
  );
}

export default function RailProofs() {
  const [read, retryRead] = useProof(readBlock);
  const [sign, retrySign] = useProof(signProof);
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-black/60 dark:text-white/60">Phase 1 · rail proofs</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Merchant Capital+</h1>
      <div className="mt-8 grid gap-4">
        <ProofCard
          title="Private chain read"
          requirement="DEP-6"
          runningText="Connecting privately… the first private read can take one to two minutes."
          retryLabel="Read block again"
          proof={read}
          onRetry={retryRead}
        />
        <ProofCard
          title="Guest wallet signature"
          requirement="DEP-3"
          runningText="Signing…"
          retryLabel="Sign again"
          proof={sign}
          onRetry={retrySign}
        />
      </div>
    </main>
  );
}
