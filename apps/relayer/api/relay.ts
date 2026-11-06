import { relay, relayerClient } from '../src/relayer.ts';

export async function POST(request: Request): Promise<Response> {
  // JSON only: a cross-site form can't send it without a CORS preflight, which this API never answers.
  const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    return Response.json({ error: 'content-type must be application/json', code: 'unsupported_media_type' }, { status: 415 });
  }
  return relay(await request.text(), relayerClient());
}
