// Display helpers shared by the investor screens. Times are India time, as on the merchant pages.
export const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;

const IST: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" };

/** "6 Dec 2026" */
export const istDate = (ms: number) => new Date(ms).toLocaleDateString("en-GB", IST);
/** "6 Dec 2026, 17:30 IST" */
export const istDateTime = (ms: number) => `${new Date(ms).toLocaleString("en-GB", { ...IST, hour: "2-digit", minute: "2-digit", hour12: false })} IST`;

export const KIND_LABEL = { advance: "Cash advance", invoice: "Invoice" } as const;

export const kindBadge = "inline-flex rounded-pill border border-current px-3 py-0.5 text-xs font-medium";
