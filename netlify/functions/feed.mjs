// Netlify: GET /feed.json — polled by the TickrMeter every minute.
// *.netlify.app certificates chain to DigiCert Global Root G2, which the firmware trusts.
import '../../server/require-shim.mjs'; // must stay first: see file
import endpoints from '../../server/endpoints.cjs';

export default async (req, context) => {
  const r = await endpoints.feed({
    method: req.method,
    origin: process.env.PUBLIC_ORIGIN || context.site.url,
    apiKey: process.env.FINNHUB_API_KEY,
  });
  return new Response(r.body, { status: r.status, headers: r.headers });
};

export const config = { path: '/feed.json', method: ['GET', 'HEAD'] };
