'use strict';

// Plain Node.js server for hosts that run a long-lived process (e.g. Render).
// Routes: GET/HEAD /feed.json, GET/HEAD /frame/<payload>.<sig>.bin, GET /healthz.
// Node writes the exact Content-Length we set, with no chunking or compression.

const http = require('node:http');
const endpoints = require('./endpoints.cjs');

const origin = () => process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || '';
const apiKey = () => process.env.FINNHUB_API_KEY;

function write(req, res, r) {
  res.writeHead(r.status, r.headers);
  res.end(r.body ?? undefined);
}

function createServer() {
  return http.createServer(async (req, res) => {
    const path = (req.url || '').split('?')[0];
    if (path === '/healthz') {
      // Health checks must not spend API calls.
      return write(req, res, { status: 200, headers: { 'Content-Length': '2', 'Content-Type': 'text/plain', 'Cache-Control': 'no-store, no-transform' }, body: Buffer.from('ok') });
    }
    if (path === '/feed.json') return write(req, res, await endpoints.feed({ method: req.method, origin: origin(), apiKey: apiKey() }));
    const match = /^\/frame\/([^/]+)$/.exec(path);
    if (match) return write(req, res, endpoints.frame({ method: req.method, token: match[1], apiKey: apiKey() }));
    write(req, res, { status: 404, headers: { 'Content-Length': '0', 'Cache-Control': 'no-store' }, body: null });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 10000);
  createServer().listen(port, '0.0.0.0', () => console.log(`TickrMeter feed listening on port ${port}`));
}

module.exports = { createServer };
