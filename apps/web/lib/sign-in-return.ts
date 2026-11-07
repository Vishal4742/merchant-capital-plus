/** Only the local OAuth consent page can interrupt the normal onboarding destination. */
export function signInReturn(value: unknown): string {
  const fallback = "/merchant/settings";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return fallback;
  const url = new URL(value, "https://whiteflow.invalid");
  if (url.origin !== "https://whiteflow.invalid" || url.pathname !== "/merchant/ai/authorize") return fallback;
  const request = url.searchParams.get("request");
  if (!request || request.length > 16000) return fallback;
  return `/merchant/ai/authorize?${new URLSearchParams({ request })}`;
}
