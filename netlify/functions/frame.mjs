// Netlify: GET /frame/<payload>.<sig>.bin — the exact 4,736-byte image named in the feed.
import '../../server/require-shim.mjs'; // must stay first: see file
import endpoints from '../../server/endpoints.cjs';

export default async (req, context) => {
  const r = endpoints.frame({ method: req.method, token: context.params.token, apiKey: process.env.FINNHUB_API_KEY });
  return new Response(r.body, { status: r.status, headers: r.headers });
};

export const config = { path: '/frame/:token', method: ['GET', 'HEAD'] };
