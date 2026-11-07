// Child process for relayer-neon.ts: runs ONE relayer state operation through the relayer's real src/state.ts + src/db.ts
// (Neon HTTP driver). DATABASE_URL (the isolated target) arrives in this process's environment only. Barrier: prints
// READY, waits for "GO" on stdin, then runs, prints one JSON line and exits.
import { createInterface } from 'node:readline';

const op = JSON.parse(process.env.WF_OP ?? '{}');
const state = await import('../../apps/relayer/src/state.ts');
const rl = createInterface({ input: process.stdin });
process.stdout.write('READY\n');
for await (const line of rl) {
  if (line.trim() !== 'GO') continue;
  rl.close();
  try {
    let result: unknown;
    if (op.kind === 'take') result = await state.takeLease(op.relayer, op.holder);
    else if (op.kind === 'write') result = await state.writeAhead({ ...op.input, feeWei: BigInt(op.input.feeWei) });
    else if (op.kind === 'ledger') {
      const l = await state.readLedger(op.relayer, op.auth, op.now);
      result = { ...l, spentWei: l.spentWei.toString() };
    } else if (op.kind === 'settle') result = await state.settle(op.auth, BigInt(op.feeWei), op.outcome, op.payerFault, op.at);
    process.stdout.write(`${JSON.stringify({ ok: true, result: result ?? null })}\n`);
  } catch (e) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: (e as Error)?.name ?? 'error' })}\n`);
  }
  break;
}
