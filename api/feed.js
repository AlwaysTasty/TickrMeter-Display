'use strict';

// Vercel: GET /feed.json (see vercel.json rewrites). Logic lives in server/endpoints.cjs.
// Note: *.vercel.app certificates chain to GTS Root R1, which current TickrMeter
// firmware does not trust; use Netlify or a Vercel custom domain for the device.

const { feed } = require('../server/endpoints.cjs');

const origin = () => process.env.PUBLIC_ORIGIN
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');

module.exports = async (req, res) => {
  const r = await feed({ method: req.method, origin: origin(), apiKey: process.env.FINNHUB_API_KEY });
  res.writeHead(r.status, r.headers);
  res.end(r.body ?? undefined);
};
