'use strict';

// Vercel: GET /frame/<payload>.<sig>.bin (see vercel.json rewrites).

const { frame } = require('../server/endpoints.cjs');

module.exports = (req, res) => {
  const r = frame({ method: req.method, token: req.query?.token, apiKey: process.env.FINNHUB_API_KEY });
  res.writeHead(r.status, r.headers);
  res.end(r.body ?? undefined);
};
