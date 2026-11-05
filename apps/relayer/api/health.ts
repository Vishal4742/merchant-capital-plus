import { health, relayerClient } from '../src/relayer.ts';

export function GET(): Promise<Response> {
  return health(relayerClient());
}
