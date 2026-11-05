import { relay, relayerClient } from '../src/relayer.ts';

// claude-contracts' G1 PullStub on 1874 (usdt = prize USDT, payee = team wallet; checked with cast 21:10).
// ponytail: inlined for Phase 1; Phase 2 imports MerchantPay's address from packages/shared.
const PULL_STUB = '0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d';

export async function POST(request: Request): Promise<Response> {
  return relay(await request.text(), relayerClient(), PULL_STUB);
}
