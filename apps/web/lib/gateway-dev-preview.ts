// Preview of the Developers screen: with GATEWAY_PREVIEW=1 (never on Vercel, see previewOn) our server reads the keys
// and webhooks from these fixtures, in the API's own shapes, instead of the database. The demo shop has some; any other
// signed-in wallet has none (the empty screen). No fixture holds a whole key or a signing secret: the API never lists them.
import type { ApiKey, Webhook } from "./gateway-dev.ts";

const MINUTE_MS = 60 * 1000;
const T0 = Date.UTC(2026, 10, 6, 3, 0); // a fixed clock, so screenshots don't drift (as in gateway-preview.ts)
const at = (minutes: number) => new Date(T0 + minutes * MINUTE_MS).toISOString();

const KEYS: ApiKey[] = [
  { id: "key_PrEvIeWsErVeR0001", label: "Shop server", kind: "sk", prefix: "sk_test_Q3vX", created_at: at(-2 * 1440), last_used_at: at(-12) },
  { id: "key_PrEvIeWbUtToN0001", label: "Pay button", kind: "pk", prefix: "pk_test_m8Lr", created_at: at(-2 * 1440 + 5), last_used_at: null },
  { id: "key_PrEvIeWsTaGiNg001", label: "Staging", kind: "sk", prefix: "sk_test_Zf1a", created_at: at(-6 * 1440), last_used_at: at(-3 * 1440) },
];

const delivery = (id: string, minutes: number, fields: Partial<Webhook["deliveries"][number]>) => ({
  id: `dlv_${id}`,
  event: "payment.succeeded",
  status: "succeeded" as const,
  attempts: 1,
  next_attempt_at: null,
  response_status: 200,
  at: at(minutes),
  ...fields,
});

const WEBHOOKS: Webhook[] = [
  {
    id: "whk_PrEvIeWsHoP00001",
    url: "https://bandrabeans.example/hooks/merchant-capital",
    created_at: at(-2 * 1440),
    deliveries: [
      delivery("PrEvIeW0005", -4, { status: "pending", attempts: 2, response_status: 503, next_attempt_at: at(1) }),
      delivery("PrEvIeW0004", -38, {}),
      delivery("PrEvIeW0003", -95, { event: "payment.refunded" }),
      delivery("PrEvIeW0002", -300, { status: "failed", attempts: 4, response_status: null }),
      delivery("PrEvIeW0001", -1440, {}),
    ],
  },
  { id: "whk_PrEvIeWsTaGe0001", url: "https://staging.bandrabeans.example/webhooks", created_at: at(-60), deliveries: [] },
];

/** The fixtures for this signed-in merchant: the demo shop's, or none. */
export const previewDev = (merchant: string, demoShop: string | undefined) =>
  demoShop && merchant.toLowerCase() === demoShop.toLowerCase() ? { keys: KEYS, webhooks: WEBHOOKS } : { keys: [] as ApiKey[], webhooks: [] as Webhook[] };
