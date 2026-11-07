// Round 3 (owner, B9): the audited unblock of a payer in cooldown. An operator CLI, deliberately not an HTTP endpoint.
// Run from apps/relayer: npm run payer:unblock -- --payer 0x… --actor <who> --reason "<why>"
// Writes one rel_payer_unblocks row (payer, actor, reason, the cooldown it lifted, time): failures up to now stop
// counting, so the cooldown ends at once. Arguments are checked before the database is touched. Prints no secrets.
import { parseArgs } from 'node:util';
import { isAddress } from 'viem';
import { DbUnavailable, errorLabel } from '../src/db.ts';
import { unblockPayer } from '../src/state.ts';

const USAGE = 'usage: npm run payer:unblock -- --payer 0x… --actor <who> --reason "<why>"';
const fail = (code: number, message: string): never => {
  console.error(message);
  process.exit(code);
};

let values: { payer?: string; actor?: string; reason?: string } = {};
try {
  ({ values } = parseArgs({ options: { payer: { type: 'string' }, actor: { type: 'string' }, reason: { type: 'string' } }, strict: true }));
} catch {
  fail(2, USAGE);
}
const [payer, actor, reason] = [values.payer?.trim() ?? '', values.actor?.trim() ?? '', values.reason?.trim() ?? ''];
if (!isAddress(payer, { strict: false }) || !actor || actor.length > 100 || !reason || reason.length > 500) fail(2, USAGE);

try {
  const result = await unblockPayer({ payer, actor, reason });
  const lifted = result.cooldownUntil === null ? 'no cooldown was active' : `lifted a cooldown that ran until ${new Date(result.cooldownUntil).toISOString()}`;
  console.log(`unblocked ${payer.toLowerCase()} by ${actor} (audit ${result.id}): ${lifted}`);
} catch (e) {
  fail(1, `unblock failed: ${e instanceof DbUnavailable ? e.message : errorLabel(e)}`);
}
