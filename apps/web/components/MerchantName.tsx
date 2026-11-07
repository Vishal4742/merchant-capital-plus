// The shop's name with a verified tick after it, at the top of every pay sheet (batch 056, FR-PAY-7). No hooks: the
// server-rendered sheets and the client checkout both use it. Our server decides `verified` (merchantVerified, SRS v3.0
// FR-BIZ-5: only a shop we actually checked), so a name a merchant typed never gets a tick on its own.
export function MerchantName({ name, verified }: { name: string; verified: boolean | undefined }) {
  return (
    <>
      {name}
      {verified && (
        <svg role="img" aria-label="Verified merchant" viewBox="0 0 16 16" className="ml-1.5 inline-block size-[0.85em] align-[-0.1em] text-accent">
          <title>Verified merchant</title>
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path d="M4.6 8.3 6.9 10.6 11.4 5.7" fill="none" className="stroke-on-accent" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );
}
